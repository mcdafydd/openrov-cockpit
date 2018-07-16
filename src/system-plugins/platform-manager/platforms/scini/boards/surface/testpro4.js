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

// To eliminate hard coding paths for require, we are modifying the NODE_PATH to include our lib folder
let oldpath = '';
if (process.env.NODE_PATH !== undefined) {
  oldpath = process.env.NODE_PATH;
}
// Just in case already been set, leave it alone
process.env.NODE_PATH = __dirname + '/../../../../../../lib:' + oldpath;
require('module').Module._initPaths();

const pro4 = require('./pro4');
pro4.logger.level = 'warn';

let parser = new pro4.Pro4();

// test with len field = 104, but data is in multiple packets - breaks right now
let parseBuf = new Buffer.from('fddf4280f0687853434e4964020040223305003373cb436626ac4300809c4366667a4300000d42ffffff7f00c00c42ffffff7f0000fefffe0000ff0000ff00ff0042001822404ceeaf3f0000c07f0000c07f0079000000000000000000000000000000000000f1', 'hex');
console.log(parser.parse(parseBuf));

// should work - light module, CRC32
parser.reset();
parseBuf = new Buffer.from('f00f3d02f00ec317c1d48300f23b4266e683be0000484208dff7fe56ff', 'hex');
console.log(parser.parse(parseBuf));

// should fail - bad total crc
parser.reset();
parseBuf = new Buffer.from('fddf4280f0687853434e49640200000005000003fefd00fc00ff03feff003067001d66726f6d5363696e692f656c7068656c2d303030653634303831653165ffff7f00c00c42ffffff7f6842234268be384200c0234000d00e4000c0fd3f00b7404200e02340dff9ad3f0000c07f0000c07f0079000000000000000000000000000000000000c6', 'hex');
console.log(parser.parse(parseBuf));

/*// should xxx
parser.reset();
parseBuf = new Buffer.from('f00ff001c5711aa3f0000007f007d00000000000000000000000000000000000068', 'hex');
console.log(parser.parse(parseBuf));
*/

// should work - BAM, CRC8
parser.reset();
parseBuf = new Buffer.from('fddf3180f0680b53434e496402004022330500ffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7f66f107c3669e00c30060b33f00a0b43f00a0aa3f00c06941ffebf440785e87400000c07f0000c07f007400000000000000000000000000000000000062', 'hex');
console.log(parser.parse(parseBuf));

// should work - gripper test
parser.reset();
parseBuf = new Buffer.from('fddf6880000d03000082000000d86814842948', 'hex');
console.log(parser.parse(parseBuf));

// read file of test strings, one per line
let lineReader = require('readline').createInterface({
  input: require('fs').createReadStream('test.pro4')
});

lineReader.on('line', function (line) {
  parser.reset();
  parseBuf = new Buffer.from(line.trim(), 'hex');
  console.log(parser.parse(parseBuf));
}); 
