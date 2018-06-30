#!/bin/bash

# Make sure nginx is running
/etc/init.d/nginx start

# Kill any stuck old cockpit processes
kill -9 `ps auxww|grep cockpit.js | grep -v grep | awk '{print $2}'`

# Create log directories
mkdir -p /opt/openrov/logs
mkdir -p /opt/openrov/images/`date +%d%h%H%M`

# Startup clump camera recording
#mjpg_streamer -i "input_http.so -H 192.168.2.218 -p 8081 -u /bmimg" -o "output_http.so -p 9999 -w /opt/openrov/www" -o "output_file.so -f /opt/openrov/images/`date +%d%h%H%M`"

# Set the primary forward camera IP here
EXTERNAL_CAM_IP=$1

# Elphel internal temperature URL
TEMP_URL='http://'$EXTERNAL_CAM_IP'/i2c.php?width=8&bus=1&adr=0x4800'

# Attempt to set defaults on camera
# Autoexposure off; JPEG 80% quality; Exposure 30ms
SET_PARAMS_URL='http://'$EXTERNAL_CAM_IP'/parsedit.php?immediate&AUTOEXP_ON=0&QUALITY=80&EXPOS=30000'
curl -v --connect-timeout 2 $SET_PARAMS_URL

# Restart all instances of mqttclient.paho (inittab will respawn)
KILL_URL='http://'$EXTERNAL_CAM_IP'/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 2 $KILL_URL
curl -v --connect-timeout 2 'http://192.168.2.211/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 2 'http://192.168.2.213/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 2 'http://192.168.2.215/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 2 'http://192.168.2.217/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 2 'http://192.168.2.218/phpshell.php?command=killall%20mqttclient.paho'

sleep 1
# Kill any mjpg_streamers hanging around before renice
killall -9 mjpg_streamer

if [$ENV = "prod"]
then
    USE_MOCK=false EXTERNAL_CAM=true EXTERNAL_CAM_URL='http://'$EXTERNAL_CAM_IP':8081/bmimg' NODE_ENV='production' PLATFORM='scini' BOARD='surface' HARDWARE_MOCK=false DEV_MODE=true cacheDirectory='/tmp/cache' DATADIR='/tmp' LOG_LEVEL='warn' IGNORE_CACHE=true configfile='/tmp/rovconfig.json' pluginsDownloadDiretory='/tmp/plugins' photoDirectory="/tmp" video_url='http://'$EXTERNAL_CAM_IP':8081/bmimg' env plugins__ui-manager__selectedUI='new-ui' node src/cockpit.js  2>&1 | tee -a /opt/openrov/logs/`date +%d%h%H%M`-`basename $0`.txt
else
    #USE_MOCK=true EXTERNAL_CAM=false EXTERNAL_CAM_URL='http://'$EXTERNAL_CAM_IP':8081/bmimg' NODE_ENV='development' PLATFORM='scini' DEBUG='*' BOARD='surface' HARDWARE_MOCK=false DEV_MODE=true cacheDirectory='/tmp/cache' DATADIR='/tmp' LOG_LEVEL='debug' IGNORE_CACHE=true configfile='/tmp/rovconfig.json' pluginsDownloadDiretory='/tmp/plugins' photoDirectory="/tmp" video_url='http://'$EXTERNAL_CAM_IP':8081/bmimg' env plugins__ui-manager__selectedUI='new-ui' node --inspect src/cockpit.js 2>&1 | tee -a /opt/openrov/logs/`date +%d%h%H%M`-`basename $0`.txt
    USE_MOCK=false EXTERNAL_CAM=true EXTERNAL_CAM_URL='http://'$EXTERNAL_CAM_IP':8081/bmimg' NODE_ENV='development' PLATFORM='scini' DEBUG='bridge, mcu, cpu, *:Notifications, app:mjpeg*' BOARD='surface' HARDWARE_MOCK=false DEV_MODE=true cacheDirectory='/tmp/cache' DATADIR='/tmp' LOG_LEVEL='debug' IGNORE_CACHE=true configfile='/tmp/rovconfig.json' pluginsDownloadDiretory='/tmp/plugins' photoDirectory="/tmp" video_url='http://'$EXTERNAL_CAM_IP':8081/bmimg' env plugins__ui-manager__selectedUI='new-ui' node --inspect src/cockpit.js 2>&1 | tee -a /opt/openrov/logs/`date +%d%h%H%M`-`basename $0`.txt
fi

# Wait 10 seconds and then renice mjpg_streamer to -1
#sleep 10
#sudo -n renice -n -1 -p `ps auxww|grep mjpg_streamer | awk '{print $2}'` && fg %1

