(function () {
  let DISABLED = 'DISABLED';
  let SCINIGripper = function SCINIGripper(deps) {
    deps.logger.debug('The scinigripper plugin.');
    let self = this;
    self.cockpit = deps.cockpit;
    self.globalEventLoop = deps.globalEventLoop;
    self.sendToROVEnabled = true;
    self.sendUpdateEnabled = true;
    self.controls = {  // 0 = stationary, 2 = open, 3 = close
      gripper_open: 0,
      gripper_close: 0,
      sampler_open: 0,
      sampler_close: 0,
      trim_open: 0,
      trim_close: 0
    }
    self.priorControls = {};
    deps.cockpit.on('plugin.scinigripper.getState', function (callback) {
      let state = {
          sendToROVEnabled: self.sendToROVEnabled,
          sendUpdateEnabled: self.sendUpdateEnabled,
          controls: self.controls
        };

      callback(state);
    });
    deps.cockpit.on('plugin.scinigripper.allStop', function () {
      self.allStop();
    });
    deps.cockpit.on('plugin.scinigripper.disable', function () {
      self.sendToROVEnabled = false;
    });
    deps.cockpit.on('plugin.scinigripper.enable', function () {
      self.sendToROVEnabled = true;
    });
    deps.cockpit.on('plugin.scinigripper.gripper_open', function () {
      self.controls.gripper_close = 0;
      self.controls.gripper_open = 1;
      self.controls.gripper_stationary = 0;
    });
    deps.cockpit.on('plugin.scinigripper.gripper_close', function () {
      self.controls.gripper_close = 1;
      self.controls.gripper_open = 0;
      self.controls.gripper_stationary = 0;
    });
    deps.cockpit.on('plugin.scinigripper.gripper_stationary', function () {
      self.controls.gripper_close = 0;
      self.controls.gripper_open = 0;
      self.controls.gripper_stationary = 1;
    });
    deps.cockpit.on('plugin.scinigripper.sampler_open', function () {
      self.controls.sampler_close = 0;
      self.controls.sampler_open = 1;
      self.controls.sampler_stationary = 0;
    });
    deps.cockpit.on('plugin.scinigripper.sampler_close', function () {
      self.controls.sampler_close = 1;
      self.controls.sampler_open = 0;
      self.controls.sampler_stationary = 0;
    });
    deps.cockpit.on('plugin.scinigripper.sampler_stationary', function () {
      self.controls.sampler_close = 0;
      self.controls.sampler_open = 0;
      self.controls.sampler_stationary = 1;
    });
    deps.cockpit.on('plugin.scinigripper.trim_open', function () {
      self.controls.trim_close = 0;
      self.controls.trim_open = 1;
      self.controls.trim_stationary = 0;
    });
    deps.cockpit.on('plugin.scinigripper.trim_close', function () {
      self.controls.trim_close = 1;
      self.controls.trim_open = 0;
      self.controls.trim_stationary = 0;
    });
    deps.cockpit.on('plugin.scinigripper.trim_stationary', function () {
      self.controls.trim_close = 0;
      self.controls.trim_open = 0;
      self.controls.trim_stationary = 1;
    });
    deps.cockpit.on('plugin.scinigripper.desiredControls', function (controls, ack, fn) {
      self.controls = controls;

      if (typeof(fn)==="function"){
        fn(ack);  //ack
      }
    });
    self.startInterval = function () {
      setInterval(function () {
        self.sendGripperData();
      }, 25);  // constantly check to see if new controls need to be sent to vehicle
    };
    self.startInterval();
    return self;
  };
  // --------------------
  SCINIGripper.prototype.allStop = function allStop() {
    self.controls.gripper = 0;
    self.controls.sampler = 0;
    self.controls.trim = 0;
  };
  SCINIGripper.prototype.sendGripperData = function () {
    let self = this;
    let controls = self.controls;
    let updateRequired = false;
    // Only send if there is a change
    for (let i in controls) {
      if (controls[i] != self.priorControls[i]) {
        updateRequired = true;
        console.log('CM = ', controls, 'PR = ', self.priorControls);
        break;
      }
    }
    if (self.sendUpdateEnabled && updateRequired || self.sendToROVEnabled === false) {
      if (self.sendToROVEnabled) {
        for (let control in self.controls) {
          if (controls[control] != self.priorControls[control]) {
            let sendToRov = control + '(' + controls[control] + ')';
            self.globalEventLoop.emit('mcu.SendCommand', sendToRov);
            console.log('CONTROL = ' + sendToRov);
          }
        }
      }
      self.priorControls = controls;
      // report back the actual controls - why are we copying this method of doing things?
      self.cockpit.emit('plugin.scinigripper.controls', self.controls);
    }
  };

  SCINIGripper.prototype.getSettingSchema = function getSettingSchema() {
    return [
      {
        'title': 'SCINI Gripper Settings',
        'id': 'sciniGripper',
        'type': "object",
        'properties': {
          'currentConfiguration':{
            'type': 'string'
          },
          'configurations': {
            'type': 'array'
          },
          'exponentialSticks': {}
        }
      }];
    };
  module.exports = function (name, deps) {
    return new SCINIGripper(deps);
  };
}());
