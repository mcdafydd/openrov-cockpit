(function (window, $)
{
  'use strict';
  class SCINIpilot
  {
    constructor(cockpit)
    {
      console.log("SCINI Pilot started");
      var self = this;

      self.cockpit = cockpit;


      self.positions = {
        throttle: 0,
        yaw: 0,
        lift: 0,
        pitch: 0,
        roll: 0,
        strafe: 0
      };
      self.powerLevel = 1;
      self.priorControls = {};

      self.sendToROVEnabled = true;
      self.sendUpdateEnabled = true;

      self.settings = {};

      //Get the stick values
      self.cockpit.withHistory.on('settings-change.rovPilot', function (settings) {
        //Init settings with defaults
        self.settings = settings.rovPilot;
      });

      //Input mappings
      self.actions =
      {
        'sciniPilot.strafeLeft':
        {
          description: "Strafe left",
          controls:
          {
            button:
            {
              down: function() {
                self.cockpit.emit('plugin.rovpilot.setStrafe', 1);
              },
              up: function() {
                self.cockpit.emit('plugin.rovpilot.setStrafe', 0);
              }
            }
          }
        },
        'sciniPilot.strafeRight':
        {
          description: "Strafe right",
          controls:
          {
            button:
            {
              down: function() {
                self.cockpit.emit('plugin.rovpilot.setStrafe', -1);
              },
              up: function() {
                self.cockpit.emit('plugin.rovpilot.setStrafe', 0);
              }
            }
          }
        },
        'sciniPilot.moveStrafe':
        {
          description: "Command strafe with gamepad thumbsticks",
          controls:
          {
            axis:
            {
              update: function(value) {
                self.cockpit.emit('plugin.rovpilot.setStrafe', value);
              }
            }
          }
        },
        'sciniPilot.movePitch':
        {
          description: "Command pitch (tilt) with gamepad thumbsticks",
          controls:
          {
            axis:
            {
              update: function(value) {
                self.cockpit.emit('plugin.rovpilot.setPitch', value);
              }
            }
          }
        }
      };

      self.inputDefaults =
      {
        keyboard:
        {
          "f": { type: "button",
                action: 'sciniPilot.strafeLeft' },
          "g": { type: "button",
                action: 'sciniPilot.strafeRight' }
        },
        gamepad:
        {
          "LEFT_STICK_X": { type: "axis",
                            action: 'sciniPilot.moveStrafe',
                            options: {
                              inverted: true,
                              exponentialSticks: {
                                enabled: false,
                                rate: 1.0
                              }
                            }
                          },
          "RIGHT_STICK_Y": { type: "axis",
                          action: 'sciniPilot.movePitch',
                          options: {
                            inverted: false,
                            exponentialSticks: {
                              enabled: false,
                              rate: 1.0
                            }
                          }
                        }
        }
      };
    };

    altMenuDefaults()
    {
      var self = this;
      return [{
          label: 'Increment power level',
          callback: function () {
            self.rov.cockpit.emit('plugin.rovpilot.incrementPowerLevel');
          }
        }];
    };

    getTelemetryDefinitions()
    {
      return [
      {
        name: 'motors.rpm',
        description: 'Thruster rpm'
      },
      {
        name: 'motors.bus_v',
        description: 'Thruster bus voltage'
      },
      {
        name: 'motors.bus_i',
        description: 'Thruster bus current'
      },
      {
        name: 'motors.temp',
        description: 'Thruster temperature'
      },
      {
        name: 'motors.fault',
        description: 'Thruster fault code'
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
      self.cockpit.withHistory.on('settings-change.rovPilot', function (settings) {

        //Init settings with defaults
        self.settings = settings.rovPilot;
      });

      /* XXX */
      self.cockpit.rov.on('plugin.scinipilot.controls', function(controls) {
        self.cockpit.emit('plugin.scinipilot.controls', controls);
      });

      /* this should never fire
      self.rovSendPilotingDataTimer = setInterval(function() {
        self.sendPilotingData();
      }, 100 );
      */

      //TODO: Make configurable
      self.cockpit.on('plugin.scinipilot.sendToROVEnabled', function (value) {
        self.sendToROVEnabled = value;
      });
    }

    sendPilotingData()
    {
      var self = this;
      var positions = self.positions;

      //Force an update if the ack has not been cleared
      var updateRequired = this.ack == null ? false : true;

      //Only send if there is a change
      var controls = {}

      controls.throttle = positions.throttle;
      controls.yaw = positions.yaw;
      controls.lift = positions.lift;
      controls.pitch = positions.pitch;
      controls.roll = positions.roll;
      controls.strafe = positions.strafe;
      for (var i in positions) {
        if (controls[i] != self.priorControls[i]) {
          updateRequired = true;
          break;
        }
      }
      if (self.sendUpdateEnabled && updateRequired || self.sendToROVEnabled === false) {
        if (self.sendToROVEnabled) {
          self.ack = performance.now();
          self.cockpit.rov.emit('plugin.rovpilot.desiredControlRates', controls, this.ack, function (ack) {
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
  plugins.SCINIpilot = SCINIpilot;
  window.Cockpit.plugins.push(plugins.SCINIpilot);
}(window, jQuery));
