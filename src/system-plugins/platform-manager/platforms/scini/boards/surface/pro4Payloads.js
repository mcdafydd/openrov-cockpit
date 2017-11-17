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

const logger            = require('AppFramework.js').logger;
const Parser            = require('binary-parser').Parser;
const pro4Constants     = require('./pro4').constants;

class Pro4Payloads
{
  constructor()
  {
    this.constants = pro4Constants;

    // stop parser to terminate parsing
    this.stop = new Parser();

    this.ParserMotors = new Parser()
      .endianess('little')
      .float('rpm')
      .float('bus_v')
      .float('bus_i')
      .float('temp')
      .uint8('fault');

    this.ParserLights = new Parser()
      .endianess('little')
      .uint8('deviceType')
      .float('bus_v')
      .float('bus_i')
      .float('temp')
      .uint8('fault');

    // Crumb read/write operation
    this.ParserBam = new Parser()
      .string('scni', 4)
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
      .uint8('kellerStatus');
  }
}

module.exports = {
  Pro4Payloads: Pro4Payloads
}