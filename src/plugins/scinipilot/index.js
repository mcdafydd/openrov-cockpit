(function () {
  var DISABLED = 'DISABLED';
  var ArduinoHelper = require('../../lib/ArduinoHelper');
  var SCINIPilot = function SCINIPilot(deps) {
    deps.logger.debug('The scinipilot plugin.');
    var self = this;
    self.SAMPLE_PERIOD = 1000 / deps.config.sample_freq;
    this.physics = new ArduinoHelper().physics;
    self.cockpit = deps.cockpit;
    self.globalEventLoop = deps.globalEventLoop;
    self.sendToROVEnabled = true;
    self.sendUpdateEnabled = true;
    self.priorControls = {};
    self.powerLevel = 1;
    self.setPowerLevel(1);
    self.positions = {
      throttle: 0,
      yaw: 0,
      lift: 0,
      pitch: 0,
      roll: 0,
      strafe: 0
    };
    deps.cockpit.on('plugin.scinipilot.getState', function (callback) {
      var state = {
          senToROVEnabled: self.sendToROVEnabled,
          sendUpdateEnabled: self.sendUpdateEnabled,
          powerLevel: self.powerLevel,
          positions: self.positions
        };
        
      callback(state);
    });
    deps.cockpit.on('plugin.rovpilot.setPowerLevel', function (value) {
      self.setPowerLevel(value);
    });
    deps.cockpit.on('plugin.rovpilot.allStop', function () {
      self.allStop();
    });
    deps.cockpit.on('plugin.scinipilot.disable', function () {
      self.sendToROVEnabled = false;
    });
    deps.cockpit.on('plugin.scinipilot.enable', function () {
      self.sendToROVEnabled = true;
    });
    deps.cockpit.on('plugin.scinipilot.desiredControlRates', function (rates, ack, fn) {
      self.positions = rates;
      if (typeof(fn)==="function"){
        fn(ack);  //ack
      }
    });
    this.startInterval = function () {
      setInterval(function () {
        self.sendPilotingData();
      }, 25);  //constantly check to see if new commands need to be sent to arduino
    };
    this.startInterval();
    return this;
  };
  // --------------------
  SCINIPilot.prototype.adjustForPowerLimit = function adjustForPowerLimit(value) {
    return value * this.power;
  };
  SCINIPilot.prototype.adjustYawForPowerLimit = function adjustYawForPowerLimit(value) {
    return Math.min(Math.max(value * this.power * 1.5, -1), 1);
  };
  SCINIPilot.prototype.setPowerLevel = function setPowerLevel(value) {
    switch (value) {
    case 1:
      this.power = 0.12;
      break;
    case 2:
      this.power = 0.25;
      break;
    case 3:
      this.power = 0.4;
      break;
    case 4:
      this.power = 0.7;
      break;
    case 5:
      this.power = 1;
      break;
    }
    this.powerLevel = value;
  };
  SCINIPilot.prototype.allStop = function allStop() {
    this.positions.throttle = 0;
    this.positions.yaw = 0;
    this.positions.lift = 0;
    this.positions.pitch = 0;
    this.positions.roll = 0;
    this.postitions.strafe = 0;
  };
  SCINIPilot.prototype.sendPilotingData = function () {
    var self = this;
    var positions = this.positions;
    var updateRequired = false;
    //Only send if there is a change
    var controls = {};
    controls.pitch = this.adjustForPowerLimit(positions.pitch);
    controls.strafe = this.adjustForPowerLimit(positions.strafe);
    for (var i in positions) {
      if (controls[i] != this.priorControls[i]) {
        updateRequired = true;
        break;
      }
    }
    if (this.sendUpdateEnabled && updateRequired || this.sendToROVEnabled === false) {
      if (this.sendToROVEnabled) {
        for (var control in controls) {
          if (controls[control] != this.priorControls[control]) {
            var command = control + '(' + controls[control] * 100 + ')';
            self.globalEventLoop.emit('mcu.SendCommand', command); 
          }
        }
      }
      // XXX
      //this.priorControls = controls;
      //report back the actual commands after power restrictions
      //var motorCommands = this.physics.mapMotors(controls.throttle, controls.yaw, controls.lift);
      //this.cockpit.emit('plugin.scinipilot.controls', motorCommands);
    }
  };
  SCINIPilot.prototype.getSettingSchema = function getSettingSchema() {
    return [
      {
        'title': 'SCINI Pilot Settings',
        'id': 'sciniPilot',
        'type': "object",
        'properties': {
          'currentConfiguration':{
            'type': 'string'
          },
          'configurations': {
            'type': 'array'
          },
          'exponentialSticks': {
            'LEFT_STICK_X': {
              'enabled': {
                'type': 'boolean',
                'default': false,
              },
              'rate': {
                'type': 'number',
                'default': 1.0
              }
            },
            'RIGHT_STICK_Y': {
              'enabled': {
                'type': 'boolean',
                'default': false,
              },
              'rate': {
                'type': 'number',
                'default': 1.0
              }
            }
          },
          'inversions': {
            'LEFT_STICK_X': {
              'type': 'boolean',
              'default': false
            },
            'RIGHT_STICK_Y': {
              'type': 'boolean',
              'default': false
            }
          }
        }
      }];
  };
  module.exports = function (name, deps) {
    return new SCINIPilot(deps);
  };
}());
