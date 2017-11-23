# Set the primary forward camera IP here
EXTERNAL_CAM_IP=$1

# Elphel internal temperature URL
TEMP_URL='http://'$EXTERNAL_CAM_IP'/i2c.php?width=8&bus=1&adr=0x4800'

# Attempt to set defaults on camera
# Autoexposure off; JPEG 80% quality; Exposure 30ms
SET_PARAMS_URL='http://'$EXTERNAL_CAM_IP'/parsedit.php?immediate&AUTOEXP_ON=0&QUALITY=80&EXPOS=30000'
curl $SET_PARAMS_URL

# Restart all instances of mqttclient.paho (inittab will respawn)
curl -v --connect-timeout 5 'http://192.168.2.211/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 5 'http://192.168.2.212/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 5 'http://192.168.2.213/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 5 'http://192.168.2.215/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 5 'http://192.168.2.217/phpshell.php?command=killall%20mqttclient.paho'

sleep 1
# Kill any mjpg_streamers hanging around before renice
killall -9 mjpg_streamer

# Comment previous line and uncomment the following if you are developing
# and need a javascript debugger
# To debug, open Chrome and visit the URL chrome://inspect
# Debugging reference:
# https://nodejs.org/en/docs/guides/debugging-getting-started/
#
USE_MOCK=false EXTERNAL_CAM=true EXTERNAL_CAM_URL='http://'$EXTERNAL_CAM_IP':8081/bmimg' NODE_ENV='development' PLATFORM='scini' DEBUG='bridge, mcu, cpu, *:Notifications, app:mjpeg*' BOARD='surface' HARDWARE_MOCK=false DEV_MODE=true cacheDirectory='/tmp/cache' DATADIR='/tmp' LOG_LEVEL='debug' IGNORE_CACHE=true configfile='/tmp/rovconfig.json' pluginsDownloadDiretory='/tmp/plugins' photoDirectory="/tmp" video_url='http://'$EXTERNAL_CAM_IP':8081/bmimg' env plugins__ui-manager__selectedUI='new-ui' node --inspect src/cockpit.js

# Wait 10 seconds and then renice mjpg_streamer to -1
sleep 10
sudo -n renice -n -1 -p `ps auxww|grep mjpg_streamer | awk '{print $2}'` &

