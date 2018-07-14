(function(window)
{
    'use strict';
    class IMU
    {
        constructor( cockpit )
        {
            console.log('IMU Plugin running');

            var self = this;
            self.cockpit = cockpit;

            this.actions =
            {
                'plugin.imu.zeroYaw':
                {
                    description: 'Zero yaw/heading when in gyro mode',
                    controls:
                    {
                        button:
                        {
                            down: function()
                            {
                                self.zeroYaw();
                            }
                        }
                    }
                }
            };

            // Setup input handlers
            this.inputDefaults =
            {
                keyboard:
                {
                    "alt+y": { type: "button", action: 'plugin.imu.zeroYaw' }
                }
            };
        };

        zeroRollPitch()
        {
            this.cockpit.rov.emit( "plugin.imu.zeroRollPitch" );
        }

        clearRollPitchOffsets()
        {
            this.cockpit.rov.emit( "plugin.imu.clearRollPitchOffsets" );
        }

        zeroYaw()
        {
            this.cockpit.rov.emit( "plugin.imu.zeroYaw" );
        }

        getTelemetryDefinitions()
        {
            return [
            {
                name: 'sensors.servo1',
                description: 'Servo 1 angle'
            },
            {
                name: 'sensors.servo2',
                description: 'Servo 2 angle'
            },
            {
                name: 'sensors.gpioIn',
                description: 'GPIO in'
            },
            {
                name: 'sensors.gpioOut',
                description: 'GPIO out'
            },
            {
                name: 'sensors.acs764',
                description: 'ACS764'
            },
            {
                name: 'sensors.tmp102',
                description: 'Tmp102'
            },
            {
                name: 'sensors.adcKelvin',
                description: 'ADC kelvin'
            },
            {
                name: 'sensors.adcVolts',
                description: 'ADC volts'
            },
            {
                name: 'sensors.adc48v',
                description: 'ADC 48 volts'
            },
            {
                name: 'sensors.adc24v',
                description: 'ADC 24 volts'
            },
            {
                name: 'sensors.adc12v',
                description: 'ADC 12 volts'
            },
            {
                name: 'sensors.kellerPressure',
                description: 'Keller pressure'
            },
            {
                name: 'sensors.kellerPressure',
                description: 'Keller pressure'
            },
            {
                name: 'sensors.kellerTemperature',
                description: 'Keller temperature'
            },
            {
                name: 'sensors.kellerPressure',
                description: 'Keller pressure'
            },
            {
                name: 'sensors.kellerStatus',
                description: 'Keller status'
            },
            {
                name: 'sensors.accel_x',
                description: 'IMU accel x'
            },
            {
                name: 'sensors.accel_y',
                description: 'IMU accel y'
            },
            {
                name: 'sensors.accel_z',
                description: 'IMU accel z'
            },
            {
                name: 'sensors.angle_x',
                description: 'IMU angle x'
            },
            {
                name: 'sensors.angle_y',
                description: 'IMU angle y'
            },
            {
                name: 'sensors.angle_z',
                description: 'IMU angle z'
            },
            {
                name: 'sensors.rot_x',
                description: 'IMU rotation x'
            },
            {
                name: 'sensors.rot_y',
                description: 'IMU rotation y'
            },
            {
                name: 'sensors.rot_z',
                description: 'IMU rotation z'
            }]
        };

        listen()
        {
            var self = this;

            // zeroRollPitch
            this.cockpit.on('plugin.imu.zeroRollPitch', function()
            {
                self.zeroRollPitch();
            });

            this.cockpit.on('plugin.imu.clearRollPitchOffsets', function()
            {
                self.clearRollPitchOffsets();
            });

            // zeroYaw
            this.cockpit.on('plugin.imu.zeroYaw', function()
            {
                self.zeroYaw();
            });
        };
    };

    var plugins = namespace('plugins');
    plugins.IMU = IMU;
    window.Cockpit.plugins.push( plugins.IMU );

}(window));