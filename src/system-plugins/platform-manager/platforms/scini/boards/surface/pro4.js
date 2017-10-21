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

// ******************************************************************
//  Device types are defined by VideoRay
//  See sample code at https://github.com/videoray/VRCommsProtocol_doc 
//  for more info.
//  Protocol constants
//  See https://github.com/videoray/VRCommsProtocol_doc/blob/master/pro4%20sample/inc/protocol_pro4.h
//
// @name Predefined Registers
//
// The ADDR_UTILITY register is used for device independent actions, such as 
// requesting the device eummeration data
// The ADDR_REBOOT register is 16-bit at addresses 0xFE-0xFF
// Writing the value 0xDEAD into the Utility register should cause the // device to reboot after a delay.
// 
// Allows for the encapsulation of a custom command protocol
// ******************************************************************

const constants = {
  DEVICE_HOST_COMPUTER: 0x0,
  DEVICE_PRO4_ROV: 0x1,
  DEVICE_MANIPULATOR: 0x2,
  DEVICE_CAMERA: 0x3,
  DEVICE_THRUSTER_MODULE: 0x4,
  DEVICE_RADIATION_SENSOR: 0x5,
  DEVICE_CP_PROBE: 0x6,
  DEVICE_LIGHT: 0x7,
  DEVICE_GENERIC_SENSOR_MODULE: 0x8,
  DEVICE_PROTOCOL_ADAPTER_MUX: 0x10,
  DEVICE_KCF_SMART_TETHER_NODE: 0x50,
  PROTOCOL_PRO4_HEADER_SIZE: 6,
  PROTOCOL_PRO4_RESPONSE_DATA_PAYLOAD_START_INDEX: 8,
  SYNC_REQUEST8LE: 0xAFFA,  // CRCs are one byte
  SYNC_REQUEST32LE: 0x5FF5,  // CRCs are four bytes
  SYNC_RESPONSE8BE: 0xFDDF,  // parsed endianness, CRCs one byte
  SYNC_RESPONSE32BE: 0xF00F,  // parsed endianness, CRCs four bytes
  ID_BROADCAST: 0xFF,
  ID_MULTICAST_FLAG: 0x80,
  ID_RELAY_REQUEST_FLAG: 0x40,
  LENGTH_EXTENDED: 0xFF, // payload larger than 254 bytes
  TOP_OF_CSR: 0xF0,
  TOP_OF_FULL_CSR: 0x100,
  ADDR_CUSTOM_COMMAND: 0xF0,
  ADDR_CONFIG_DATA_SIZE: 0xF5,
  ADDR_CONFIG_DATA: 0xF7,
  ADDR_NODE_ID: 0xFB,
  ADDR_GROUP_ID: 0xFC,
  ADDR_DEVICE_ID: 0xFD, // returns factory unique ID
  ADDR_UTILITY: 0xFE,
  ADDR_REBOOT: 0xFE,
  REBOOT_CODE: 0xADDE  // LSB First
}; 

class Pro4
{
  constructor()
  {
    this.constants = constants;
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

    if (sync === this.constants.SYNC_REQUEST32LE) {
      padding = 4;
    }

    // Create PRO4 packet
    let skip = this.constants.PROTOCOL_PRO4_HEADER_SIZE + padding + len;
    let buf = new Buffer.allocUnsafe(skip + padding);
    buf.writeUInt16LE(sync, 0);
    buf.writeUInt8(id, 2);
    buf.writeUInt8(flags, 3);
    buf.writeUInt8(csrAddress, 4);
    buf.writeUInt8(len, 5);
    // Write header checksum
    if (sync === this.constants.SYNC_REQUEST32LE) {
      buf.writeUInt32LE(CRC.crc32(buf.slice(0,6)), this.constants.PROTOCOL_PRO4_HEADER_SIZE+1);
    }
    if (sync === this.constants.SYNC_REQUEST8LE) {
      buf.writeUInt8(CRC.crc8(buf.slice(0,6)), 
        this.constants.PROTOCOL_PRO4_HEADER_SIZE+1);
    }
    payload.copy(buf, this.constants.PROTOCOL_PRO4_HEADER_SIZE + padding, 0);
    // Write total checksum
    if (sync === this.constants.SYNC_REQUEST32LE) {
      buf.writeUInt32LE(CRC.crc32(buf.slice(0,skip)), skip);
    }
    if (sync === this.constants.SYNC_REQUEST8LE) {
      buf.writeUInt8(CRC.crc8(buf.slice(0,skip)), skip);
    }

    logger.debug('BRIDGE: Debug PRO4 request = ' + buf.toString('hex'))
    return buf;
  }

  // Parse PRO4 response and validate checksum
  decode(data)
  {
    let retVal;
    // parsed objects are big endian
    let obj = this.ParserHead(data);
    let headerCrcPass = true;
    let totalCrcPass = true;
    let padding = 1;
    

    if (obj.sync === this.constants.SYNC_RESPONSE32BE) {
      padding = 4;
    }
    let end = this.constants.PROTOCOL_PRO4_HEADER_SIZE + padding + obj.len;
    
    // validate header CRC
    if (obj.sync == this.constants.SYNC_RESPONSE32BE) {
      if (obj.headerCrc !== CRC.crc32(data.slice(0,6))) {
        headerCrcPass = false;
        logger.warn('BRIDGE: Bad header crc possible id = ' + obj.id);
      }
    }
    if (obj.sync == this.constants.SYNC_RESPONSE8BE) {
      if (obj.headerCrc !== CRC.crc8(data.slice(0,6))) {
        headerCrcPass = false;
        logger.warn('BRIDGE: Bad header crc possible id = ' + obj.id);
      }
    }

    // validate total CRC
    if (obj.sync == this.constants.SYNC_RESPONSE32BE) {
      if (obj.headerCrc !== CRC.crc32(data.slice(0,end))) {
        totalCrcPass = false;
        logger.warn('BRIDGE: Bad total crc possible id = ' + obj.id);
      }
    }
    if (obj.sync == this.constants.SYNC_RESPONSE8BE) {
      if (obj.headerCrc !== CRC.crc8(data.slice(0,end))) {
        totalCrcPass = false;
        logger.warn('BRIDGE: Bad total crc possible id = ' + obj.id);
      }
    }

    if (headerCrcPass && totalCrcPass) {
      retVal = obj;
    }
    else {
      retVal = {};
    }

    logger.debug('BRIDGE: Debug PRO4 response = ' + obj.toString('hex'));
    return retVal;
  }
}

module.exports = {
  Pro4: Pro4,
  constants: constants
}