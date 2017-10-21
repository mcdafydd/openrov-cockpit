/*
   COPYRIGHT (C) David McPike

   All rights reserved.

   Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions are met:

   * Redistributions of source code must retain the above copyright
     notice, this list of conditions and the following disclaimer.

   * Redistributions in binary form must reproduce the above copyright
     notice, this list of conditions and the following disclaimer in
     the documentation and/or other materials provided with the
     distribution.

   * Neither the name of the copyright holders nor the names of
     contributors may be used to endorse or promote products derived
     from this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
  SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
  CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
  POSSIBILITY OF SUCH DAMAGE.
*/

const logger = require('AppFramework.js').logger;
const Parser = require('binary-parser').Parser;
const CRC    = require('crc');

/* 
  These types are defined by VideoRay
  See sample code at https://github.com/videoray/VRCommsProtocol_doc 
  for more info.
*/
const DEVICE_HOST_COMPUTER = 0x0;
const DEVICE_PRO4_ROV = 0x1;
const DEVICE_MANIPULATOR = 0x2;
const DEVICE_CAMERA = 0x3;
const DEVICE_THRUSTER_MODULE = 0x4;
const DEVICE_RADIATION_SENSOR = 0x5;
const DEVICE_CP_PROBE = 0x6;
const DEVICE_LIGHT = 0x7;
const DEVICE_GENERIC_SENSOR_MODULE = 0x8;
const DEVICE_PROTOCOL_ADAPTER_MUX = 0x10;
const DEVICE_KCF_SMART_TETHER_NODE = 0x50;

/*
  Protocol constants
  See https://github.com/videoray/VRCommsProtocol_doc/blob/master/pro4%20sample/inc/protocol_pro4.h
*/
const PROTOCOL_PRO4_HEADER_SIZE = 6;
const PROTOCOL_PRO4_RESPONSE_DATA_PAYLOAD_START_INDEX = 8;
const SYNC_REQUEST8LE = 0xAFFA;  // CRCs are one byte
const SYNC_REQUEST32LE = 0x5FF5;  // CRCs are four bytes
const SYNC_RESPONSE8LE = 0xDFFD;  // CRCs are one byte
const SYNC_RESPONSE32LE = 0x0FF0;  // CRCs are four bytes
const ID_BROADCAST = 0xFF;
const ID_MULTICAST_FLAG = 0x80;
const ID_RELAY_REQUEST_FLAG = 0x40;
const LENGTH_EXTENDED = 0xFF; // payload larger than 254 bytes
const TOP_OF_CSR = 0xF0;
const TOP_OF_FULL_CSR = 0x100;

/**
 *  @name Predefined Registers
 */
/*@{*/
/** Allows for the encapsulation of a custom command protocol */
const ADDR_CUSTOM_COMMAND = 0xF0;
const ADDR_CONFIG_DATA_SIZE = 0xF5;
const ADDR_CONFIG_DATA = 0xF7;
const ADDR_NODE_ID = 0xFB;
const ADDR_GROUP_ID = 0xFC;
/** The device ID returns the factory programmed unique ID for this device */
const ADDR_DEVICE_ID = 0xFD;
/**The Utility register to be for device independent actions, such as requesting the device eummeration data
   The Utility register is 16-bit at addresses 0xFE-0xFF
   Writing the value 0xDEAD into the Utility register should causes the device 
   to reboot after a delay.
   
   This was previously just the REBOOT Register
*/
const ADDR_UTILITY = 0xFE;

/** The Reboot register is 16-bit at addresses 0xFE & 0xFF
    Writing the value 0xDEAD into the reboot register should causes the device 
    to reboot after a delay.
*/
const ADDR_REBOOT = 0xFE;
/* Note: 16-bit code is LSB First */
const REBOOT_CODE = 0xADDE;
const REBOOT_CODE_1 = 0xDE;
const REBOOT_CODE_2 = 0xAD;
/*@}*/

/**
 *  @name Marcos and defines for Flag byte 
 * 
 *  The FLAG byte in a request packet defines the type of response requested.
 */
/*@{*/
//const NO_RESPONSE = 0x0;
//const RESPONSE_TYPE_FLAG = 0x80;
//const RESPONSE_CSR_DUMP = 0x80;
//const RESPONSE_LENGTH_MASK = (~RESPONSE_TYPE_FLAG);
/** Test if FLAG indicates a device specific response */
//const RESPONSE_IS_DEVICE_SPECIFIC(x) (!(x & RESPONSE_TYPE_FLAG))
/** Return length of the desired response, start address is in the Address byte*/
//const RESPONSE_LENGTH(x) (x & RESPONSE_LENGTH_MASK)
/** Helper to extract the device type byte from the data payload */
//const RESPONSE_DEVICE_TYPE(x) (x[0])
/** Helper to extract the actual data payload from a response */
//const RESPONSE_PAYLOAD_DATA(x) (&x[1])
/*@}*/

class Pro4
{
  constructor()
  {
    // Define a parser for the board information stored on the controller board's eeprom
    this.ParserCrc8 = new Parser()
      .endianess('little')
      .uint8('id')
      .uint8('flags')
      .uint8('csrAddress')
      .uint8('payloadLength')
      .uint8('headerCrc');

    this.ParserCrc32 = new Parser()
    .endianess('little')
    .uint8('id')
    .uint8('flags')
    .uint8('csrAddress')
    .uint8('payloadLength')
    .uint32('headerCrc');

    this.ParserHead = new Parser()
      .endianess('little')
      .uint16('sync', {
        assert: function(x) {
          return x === this.SYNC_REQUEST8LE || x === this.SYNC_REQUEST32LE;
        }
      })
      .choice('crcType', {
        tag: 'sync',
        choices: {
          // 0xfddf response
          64991: Parser.start().nest('crc8', { type: this.ParserCrc8 }),
          // 0xf00f response
          61455: Parser.start().nest('crc32', { type: this.ParserCrc32 }),
        }
      })
  }

  // Encode PRO4 request and calculate checksum
  encode(sync, id, flags, csrAddress, len, payload)
  {
    // assume 1-byte CRC message, parser errors on invalid sync bytes
    let padding = 1;

    if (sync === 0xf55f) {
      padding = 4;
    }

    // Create PRO4 packet
    let skip = this.PROTOCOL_PRO4_HEADER_SIZE + padding + len;
    let buf = Buffer.allocUnsafe(skip + padding);
    buf.writeUInt16LE(sync);
    buf.writeUint8(id);
    buf.writeUint8(flags);
    buf.writeUint8(csrAddress);
    buf.writeUint8(len);
    // Write header checksum
    if (sync === 0xf55f) {
      buf.writeUInt32LE(CRC.crc32(buf.slice(0,6)), this.PROTOCOL_PRO4_HEADER_SIZE+1);
    }
    if (sync === 0xfaaf) {
      buf.writeUInt8(CRC.crc8(buf.slice(0,6)), this.PROTOCOL_PRO4_HEADER_SIZE+1);
    }
    buf.concat([payload], 1);
    // Write total checksum
    if (sync === 0xf55f) {
      buf.writeUInt32LE(CRC.crc32(buf.slice(0,skip)), skip+1);
    }
    if (sync === 0xfaaf) {
      buf.writeUInt8(CRC.crc8(buf.slice(0,skip)), skip+1);
    }

    return buf;
  }

  // Parse PRO4 response and validate checksum
  decode(data)
  {
    let retVal;
    let obj = this.ParserHead(data);
    let headerCrcPass = true;
    let totalCrcPass = true;
    let padding = 1;
    
    if (obj.sync === 0xf55f) {
      padding = 4;
    }
    let end = this.PROTOCOL_PRO4_HEADER_SIZE + padding + obj.len;
    
    // validate header CRC
    if (obj.sync == 0xf55f) {
      if (obj.headerCrc !== CRC.crc32(data.slice(0,6))) {
        headerCrcPass = false;
        logger.debug('BRIDGE: Bad header crc possible id = ' + obj.id);
      }
    }
    if (obj.sync == 0xfaaf) {
      if (obj.headerCrc !== CRC.crc8(data.slice(0,6))) {
        headerCrcPass = false;
        logger.debug('BRIDGE: Bad header crc possible id = ' + obj.id);
      }
    }

    // validate total CRC
    if (obj.sync == 0xf55f) {
      if (obj.headerCrc !== CRC.crc32(data.slice(0,end))) {
        totalCrcPass = false;
        logger.debug('BRIDGE: Bad total crc possible id = ' + obj.id);
      }
    }
    if (obj.sync == 0xfaaf) {
      if (obj.headerCrc !== CRC.crc8(data.slice(0,end))) {
        totalCrcPass = false;
        logger.debug('BRIDGE: Bad total crc possible id = ' + obj.id);
      }
    }

    if (headerCrcPass && totalCrcPass) {
      retVal = obj;
    }
    else {
      retVal = {};
    }

    return retVal;
  }
}

module.exports = Pro4;

