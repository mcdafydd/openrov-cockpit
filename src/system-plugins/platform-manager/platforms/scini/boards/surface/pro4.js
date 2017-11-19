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

const logger        = require('AppFramework.js').logger;
const Parser        = require('binary-parser').Parser;
const CRC           = require('crc');

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
  SYNC_REQUEST8BE: 0xFAAF,  // CRCs are one byte
  SYNC_REQUEST32BE: 0xF55F,  // CRCs are four bytes
  SYNC_RESPONSE8LE: 0xDFFD,  // parsed endianness, CRCs one byte
  SYNC_RESPONSE32LE: 0x0FF0,  // parsed endianness, CRCs four bytes
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

    // stop parser to terminate parsing
    this.stop = new Parser();

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
          // 'this' context not accessible here
          // matches SYNC_REQUEST8LE or SYNC_REQUEST32LE or "mqttClientConnected"
          if (!(x === 0xdffd || x === 0x0ff0 || x === 29037)) {
              console.log('PRO4: Partial or non-PRO4 packet sent to parser');
          } 
          return true; // always return true to prevent interruption
        } 
      })
      .choice('crcType', {
        tag: 'sync',
        choices: {
          // 0xfddf response (arrives as 0xdffd)
          57341: Parser.start().nest('crc8', { type: this.ParserCrc8 }),
          // 0xf00f response (arrives as 0x0ff0)
          4080: Parser.start().nest('crc32', { type: this.ParserCrc32 }),
          // client joined - publishes mqttClientConnected
          29037: this.stop
        }
      })

    // VideoRay PRO4 thruster response payload
    this.ParserMotors = new Parser()
      .endianess('little')
      .float('rpm')
      .float('bus_v')
      .float('bus_i')
      .float('temp')
      .uint8('fault');

    // VideoRay PRO4 light module response payload
    this.ParserLights = new Parser()
      .endianess('little')
      .uint8('deviceType')
      .float('bus_v')
      .float('bus_i')
      .float('temp')
      .uint8('fault');

    // SCINI crumb644 PRO4 response payload
    this.ParserBam = new Parser()
      .string('scni', { length: 4 })
      .uint8('len')
      .uint8('cmd')
      .uint16le('servo1')
      .uint16le('servo2')
      .uint8('gpioOut')
      .uint8('gpioIn')
      .array('acs764', {
        type: 'floatle',
        length: 4
      })
      .array('tmp102', {
        type: 'floatle',
        length: 4
      })
      .array('adcKelvin', {
        type: 'floatle',
        length: 2
      })
      .array('adcVolts', {
        type: 'floatle',
        length: 3
      })
      .floatle('adc48v')      
      .floatle('adc24v')      
      .floatle('adc12v')            
      .floatle('kellerTemperature')      
      .floatle('kellerPressure')
      .uint8('kellerStatus')
      .uint8('pad')
      .int16le('accel_x')
      .int16le('accel_y')
      .int16le('accel_z')
      .int16le('angle_x')
      .int16le('angle_y')
      .int16le('angle_z')
      .int16le('rot_x')
      .int16le('rot_y')
      .int16le('rot_z')
  }

  // Encode PRO4 request and calculate checksum
  encode(sync, id, flags, csrAddress, len, payload)
  {
    // to hold 1-byte checksums
    let chksum = 0;
    // assume 1-byte CRC message, parser errors on invalid sync bytes
    let padding = 1;

    if (sync === this.constants.SYNC_REQUEST32LE) {
      padding = 4;
    }

    // Create PRO4 packet
    let headerLen = this.constants.PROTOCOL_PRO4_HEADER_SIZE + padding;
    let skip = headerLen + len;
    let buf = new Buffer.allocUnsafe(skip + padding);
    buf.writeUInt16LE(sync, 0);
    buf.writeUInt8(id, 2);
    buf.writeUInt8(flags, 3);
    buf.writeUInt8(csrAddress, 4);
    buf.writeUInt8(len, 5);
    // Write header checksum
    if (sync === this.constants.SYNC_REQUEST32LE) {
      buf.writeUInt32LE(CRC.crc32(buf.slice(0,6)), this.constants.PROTOCOL_PRO4_HEADER_SIZE);
    }
    if (sync === this.constants.SYNC_REQUEST8LE) {
      chksum = buf[0] ^ buf[1];
      for (let i = 2; i < this.constants.PROTOCOL_PRO4_HEADER_SIZE; i++) {
        chksum ^= buf[i];
      }
      buf.writeUInt8(chksum, this.constants.PROTOCOL_PRO4_HEADER_SIZE);
      logger.debug('DEBUG: My crc8 total = ' + chksum.toString(16));; 
    }

    payload.copy(buf, headerLen);

    // Write total checksum
    if (sync === this.constants.SYNC_REQUEST32LE) {
      buf.writeUInt32LE(CRC.crc32(buf.slice(headerLen, skip)), skip);
    }
    if (sync === this.constants.SYNC_REQUEST8LE) {
      chksum = buf[7] ^ buf[8];
      for (let i = 9; i < skip; i++) {
        chksum ^= buf[i];
      }
      buf.writeUInt8(chksum, skip);
      logger.debug('DEBUG: My crc8 total = ' + chksum.toString(16));
    }

    logger.debug('BRIDGE: Debug PRO4 request = ' + buf.toString('hex'))
    return buf;
  }

  // Parse PRO4 response and validate checksum
  decode(data)
  {
    let self = this;
    let retVal;
    // parsed objects are big endian
    let obj = self.ParserHead.parse(data);
    let chksum = 0;
    let headerCrcPass = true;
    let totalCrcPass = true;
    let padding = 1;
    

    if (obj.sync === self.constants.SYNC_RESPONSE32BE) {
      padding = 4;
    }
    
    let headerLen = this.constants.PROTOCOL_PRO4_HEADER_SIZE + padding;
    let payloadLen = data.length - headerLen - padding;
    
    // validate header CRC
    if (obj.sync == self.constants.SYNC_RESPONSE32BE) {
      if (obj.crcType.crc32.headerCrc !== CRC.crc32(data.slice(0,6))) {
        headerCrcPass = false;
        logger.warn('BRIDGE: Bad header crc; possible id = ' + obj.crcType.crc32.id);
      }
    }
    if (obj.sync == this.constants.SYNC_RESPONSE8BE) {
      // calc 1-byte checksum
      chksum = data[0] ^ data[1];
      for (let i = 2; i < self.constants.PROTOCOL_PRO4_HEADER_SIZE; i++) {
        chksum ^= data[i];
      }
      if (obj.crcType.crc8.headerCrc !== chksum) {
        headerCrcPass = false;
        logger.warn('BRIDGE: Bad header crc; possible id = ' + obj.crcType.crc8.id);
      }   
    }

    // validate total CRC
    if (obj.sync == this.constants.SYNC_RESPONSE32BE) {
      if (obj.crcType.crc32.headerCrc !== CRC.crc32(data.slice(headerLen,data.length-padding))) {
        totalCrcPass = false;
        logger.warn('BRIDGE: Bad total crc; possible id = ' + obj.crcType.crc32.id);
      }
    }
    if (obj.sync == this.constants.SYNC_RESPONSE8BE) {
      // calc 1-byte checksum
      chksum = data[7] ^ data[8];
      for (let i = 9; i < data.length-padding; i++) {
        chksum ^= data[i];
      }
      if (obj.crcType.crc8.headerCrc !== chksum) {
        totalCrcPass = false;
        logger.warn('BRIDGE: Bad total crc; possible id = ' + obj.crcType.crc8.id);
      }
    }

    if (headerCrcPass && totalCrcPass) {
      // extract payload and send to parser
      // add to retVal object property
      let begin = 0;
      if (obj.sync == self.constants.SYNC_RESPONSE32LE) {
        obj.id = obj.crcType.crc32.id;
        begin = data.length - padding - obj.crcType.crc32.payloadLength;
      }
      if (obj.sync == self.constants.SYNC_RESPONSE8LE) {
        obj.id = obj.crcType.crc8.id;
        begin = data.length - padding - obj.crcType.crc8.payloadLength;
      }
      let end = data.length - padding;
      let payload = data.slice(begin, end);
      // now parse payload based on device ID
      // obj.type used by browser telemetry plugin
      if (obj.id >= 11 && obj.id <= 17) {
        obj.type = 'thruster';
        obj.payload = self.ParserMotors.parse(payload);        
      }
      else if (obj.id >= 61 && obj.id <= 64) {
        obj.type = 'lights';
        obj.payload = self.ParserLights.parse(payload);        
      }
      else if ((obj.id >= 42 && obj.id <= 51)) {
        obj.type = 'crumb';
        obj.payload = self.ParserBam.parse(payload);        
      }

      retVal = obj;
    }
    else {
      retVal = {};
    }

    return retVal;
  }
}

module.exports = {
  Pro4: Pro4,
  constants: constants
}
