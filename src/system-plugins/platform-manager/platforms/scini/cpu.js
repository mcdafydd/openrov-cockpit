var Promise = require('bluebird');
var readFileAsync = Promise.promisify(require('fs').readFile);
var execFileAsync = require('child-process-promise').execFile;
var path = require('path');

var CPUInterface = function () 
{
  var self = this;
};

CPUInterface.prototype.Compose = function (platform) 
{
  console.log('CPU: Composing SCINI cpu interface...');

  // Temporary container used for cpu detection and info loading
  var cpu = { targetCPU: platform.cpu };
  var self = this;

  // Compose the CPU interface object
  return self.LoadInfo(cpu)
    .then(self.CheckSupport)
    .then(self.LoadInterfaceImplementation);
};

CPUInterface.prototype.LoadInfo = function (cpu) {
  console.log('CPU: Loading SCINI cpu info...');

  // Add revision and serial details to the interface object
  return Promise.try(function () {
    cpu.info = {
      revision: 'Generic x86/x86-64 computer',
      serial: 'SCINI'
    };
    console.log('CPU Info: ' + JSON.stringify(cpu.info));
    return cpu;
  })
};

CPUInterface.prototype.CheckSupport = function (cpu) 
{
  let p = path.resolve(__dirname, 'cpu/revisionInfo.json');
  return readFileAsync(p)
  .then(JSON.parse)
  .then(function (json) {
    // Lookup cpu details in the raspi json file, based on revision
    var details = json[cpu.info.revision];
    if (details !== undefined) {
      // Board is supported. Add the retrieved details to the interface object
      for (var prop in details) {
        cpu.info[prop] = details[prop];
      }
      // Add the info to the target CPU Interface
      cpu.targetCPU.info = cpu.info;
      
      return cpu;
    } else {
      throw new Error('Board doesn\'t exist in database.');
    }
  });
};

CPUInterface.prototype.LoadInterfaceImplementation = function (cpu) {
  console.log('CPU: Loading SCINI CPU interface implementation');
  // Load and apply the interface implementation to the actual CPU interface
  require('./cpu/setup.js')(cpu.targetCPU);
  return cpu;
};

module.exports = new CPUInterface();
