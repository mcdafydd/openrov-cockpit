(function (window, $)
{
  'use strict';
  class SCINIgripper
  {
    constructor(cockpit)
    {
      console.log("SCINI Gripper started");
      var self = this;

      self.cockpit = cockpit;

      self.priorControls = {};
      self.controls = {
        gripper_open: 0,
        gripper_close: 0,
        sampler_open: 0,
        sampler_close: 0,
        trim_open: 0,
        trim_close: 0
      };

      self.sendToROVEnabled = true;
      self.sendUpdateEnabled = true;

      self.settings = {};

      //Get the stick values
      self.cockpit.withHistory.on('settings-change.sciniGripper', function (settings) {
        //Init settings with defaults
        self.settings = settings.sciniGripper;
      });

      //Input mappings
      self.actions =
      {
        'sciniGripper.gripper_open':
        {
          description: "Open main gripper",
          controls:
          {
            button:
            {
              down: function() {
                self.cockpit.emit('plugin.scinigripper.gripper_open', 1);
              },
              up: function() {
                self.cockpit.emit('plugin.scinigripper.gripper_open', 0);
              }
            }
          }
        },
        'sciniGripper.gripper_close':
        {
          description: "Close main gripper",
          controls:
          {
            button:
            {
              down: function() {
                self.cockpit.emit('plugin.scinigripper.gripper_close', 1);
              },
              up: function() {
                self.cockpit.emit('plugin.scinigripper.gripper_close', 0);
              }
            }
          }
        },
        'sciniGripper.sampler_open':
        {
          description: "Open sampler gripper",
          controls:
          {
            button:
            {
              down: function() {
                self.cockpit.emit('plugin.scinigripper.sampler_open', 1);
              },
              up: function() {
                self.cockpit.emit('plugin.scinigripper.sampler_open', 0);
              }
            }
          }
        },
        'sciniGripper.sampler_close':
        {
          description: "Close sampler gripper",
          controls:
          {
            button:
            {
              down: function() {
                self.cockpit.emit('plugin.scinigripper.sampler_close', 1);
              },
              up: function() {
                self.cockpit.emit('plugin.scinigripper.sampler_close', 0);
              }
            }
          }
        },
        'sciniGripper.trim_open':
        {
          description: "Open trim gripper",
          controls:
          {
            button:
            {
              down: function() {
                self.cockpit.emit('plugin.scinigripper.trim_open', 1);
              },
              up: function() {
                self.cockpit.emit('plugin.scinigripper.trim_open', 0);
              }
            }
          }
        },
        'sciniGripper.trim_close':
        {
          description: "Close trim gripper",
          controls:
          {
            button:
            {
              down: function() {
                self.cockpit.emit('plugin.scinigripper.trim_close', 1);
              },
              up: function() {
                self.cockpit.emit('plugin.scinigripper.trim_close', 0);
              }
            }
          }
        }
      };

      self.inputDefaults =
      {
        keyboard:
        {
          "u": { type: "button",
                action: 'sciniGripper.gripper_open' },
          "i": { type: "button",
                action: 'sciniGripper.gripper_close' },
          "j": { type: "button",
                action: 'sciniGripper.sampler_open' },
          "k": { type: "button",
                action: 'sciniGripper.sampler_close' },
          "n": { type: "button",
                action: 'sciniGripper.trim_open' },
          "m": { type: "button",
                action: 'sciniGripper.trim_close' }
        },
        gamepad:
        {
          "DPAD_UP": { type: "button",
                      action: "sciniGripper.gripper_open" },
          "DPAD_DOWN": { type: "button",
                      action: "sciniGripper.gripper_close" }

        }
      };
    };

    altMenuDefaults()
    {
      var self = this;
      return [{
        }];
    };

    getTelemetryDefinitions()
    {
      return [
      {
        name: 'gripper.gripper_open',
        description: 'Gripper open command active'
      },
      {
        name: 'gripper.gripper_closed',
        description: 'Gripper close command active'
      },
      {
        name: 'gripper.gripper_stationary',
        description: 'Gripper stationary command active'
      },
      {
        name: 'gripper.cmd',
        description: 'Gripper command response'
      },
      {
        name: 'gripper.cmdStatus',
        description: 'Gripper command response status'
      },
      {
        name: 'gripper.lim_i',
        description: 'Gripper current limit'
      },
      {
        name: 'gripper.current',
        description: 'Gripper current'
      },
      {
        name: 'gripper.temp',
        description: 'Gripper temperature'
      },
      {
        name: 'gripper.devAddress',
        description: 'Gripper dev address'
      },
      {
        name: 'gripper.firmwareVersion',
        description: 'Gripper firmware version'
      },
      {
        name: 'sampler.gripper_open',
        description: 'Gripper open command active'
      },
      {
        name: 'sampler.gripper_closed',
        description: 'Gripper close command active'
      },
      {
        name: 'sampler.gripper_stationary',
        description: 'Gripper stationary command active'
      },
      {
        name: 'sampler.cmd',
        description: 'Gripper command response'
      },
      {
        name: 'sampler.cmdStatus',
        description: 'Gripper command response status'
      },
      {
        name: 'sampler.lim_i',
        description: 'Gripper current limit'
      },
      {
        name: 'sampler.current',
        description: 'Gripper current'
      },
      {
        name: 'sampler.temp',
        description: 'Gripper temperature'
      },
      {
        name: 'sampler.devAddress',
        description: 'Gripper dev address'
      },
      {
        name: 'sampler.firmwareVersion',
        description: 'Gripper firmware version'
      },
      {
        name: 'trim.gripper_open',
        description: 'Gripper open command active'
      },
      {
        name: 'trim.gripper_closed',
        description: 'Gripper close command active'
      },
      {
        name: 'trim.gripper_stationary',
        description: 'Gripper stationary command active'
      },
      {
        name: 'trim.cmd',
        description: 'Gripper command response'
      },
      {
        name: 'trim.cmdStatus',
        description: 'Gripper command response status'
      },
      {
        name: 'trim.lim_i',
        description: 'Gripper current limit'
      },
      {
        name: 'trim.current',
        description: 'Gripper current'
      },
      {
        name: 'trim.temp',
        description: 'Gripper temperature'
      },
      {
        name: 'trim.devAddress',
        description: 'Gripper dev address'
      },
      {
        name: 'trim.firmwareVersion',
        description: 'Gripper firmware version'
      }]
    };

    listen()
    {
      //As a general rule, we want to set a desired state before going over the
      //the wire to deliver control signals.  All kinds of problems from late arriving
      //packets to dropped packets can really do bad things.  We listen for the
      //control commands from the UI/Input devices and we set the desired orientation
      //and position state.  We send that desired state up to the server when it
      //changes.
      //Ideally, we could put hooks in so that we get verification that a requested state
      //has been acknowledged by the ROV so that we can automatically retry sending state
      //if that awk timesout.
      //We can also send our state updates with a timestamp if we figure out a way
      //to deal with the clocks not being in sync between the computer and the ROV.
      var self = this;


      //Initial
      //Get the stick values
      self.cockpit.withHistory.on('settings-change.sciniGripper', function (settings) {

        //Init settings with defaults
        self.settings = settings.sciniGripper;
      });

      /* XXX */
      self.cockpit.rov.on('plugin.scinigripper.controls', function(controls) {
        self.cockpit.emit('plugin.scinigripper.controls', controls);
      });

      self.sciniSendGripperDataTimer = setInterval(function() {
        self.sendGripperData();
      }, 100 );

      //TODO: Make configurable
      self.cockpit.on('plugin.scinigripper.sendToROVEnabled', function (value) {
        self.sendToROVEnabled = value;
      });

      self.cockpit.on('plugin.scinigripper.gripper_open', function(value) {
        self.controls.gripper_open = value;
      });

      self.cockpit.on('plugin.scinigripper.gripper_close', function (value) {
        self.controls.gripper_close = value;
      });

      self.cockpit.on('plugin.scinigripper.sampler_open', function (value) {
        self.controls.sampler_open = value;
      });

      self.cockpit.on('plugin.scinigripper.sampler_close', function (value) {
        self.controls.sampler_close = value;
      });

      self.cockpit.on('plugin.scinigripper.trim_open', function (value) {
        self.controls.trim_open = value;
      });

      self.cockpit.on('plugin.scinigripper.trim_close', function (value) {
        self.controls.trim_close = value;
      });
    }

    sendGripperData()
    {
      let self = this;

      //Force an update if the ack has not been cleared
      let updateRequired = self.ack == null ? false : true;

      let parent = self.controls;
      //Only send if there is a change
      let controls = {};
      controls.gripper_open = parent.gripper_open;
      controls.gripper_close = parent.gripper_close;
      controls.sampler_open = parent.sampler_open;
      controls.sampler_close = parent.sampler_close;
      controls.trim_open = parent.trim_open;
      controls.trim_close = parent.trim_close;
      for (let i in parent) {
        if (controls[i] != self.priorControls[i]) {
          updateRequired = true;
          break;
        }
      }
      if (self.sendUpdateEnabled && updateRequired || self.sendToROVEnabled === false) {
        if (self.sendToROVEnabled) {
          self.ack = performance.now();
          self.cockpit.rov.emit('plugin.scinigripper.desiredControls', controls, self.ack, function (ack) {
            if (ack === self.ack) {
              self.ack = null;
            }
          });
        }
        self.priorControls = controls;
      }
    }
  };

  var plugins = namespace('plugins');
  plugins.SCINIgripper = SCINIgripper;
  window.Cockpit.plugins.push(plugins.SCINIgripper);
}(window, jQuery));
