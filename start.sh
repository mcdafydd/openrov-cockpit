#!/bin/bash

# Make sure nginx is running
/etc/init.d/nginx start

# Kill any stuck old cockpit processes
kill -9 `ps auxww|grep cockpit.js | grep -v grep | awk '{print $2}'`

# Used by mjpeg-video-server Supervisor
MAX_CAMERAS=5

# Set the primary forward camera IP here
EXTERNAL_CAM_IP=$1

# Set list of other known cameras here
OTHER_CAM_IPS="192.168.2.211 192.168.2.213 192.168.2.217 192.168.2.218"
# We have to pass this to OpenROV, just put it in the environment for now
export OTHER_CAM_URL="http://192.168.2.211:8081/bmimg http://192.168.2.213:8081/bmimg http://192.168.2.217:8081/bmimg http://192.168.2.218:8081/bmimg"

SETENV=$2
# Set default debug statements for development
# May be overridden by docker-compose environment
if [ -z "$DEBUGFLAGS" ]; then
  DEBUGFLAGS="bridge, mcu, cpu, *:Notifications, app:mjpeg*"
fi

# Restart all instances of mqttclient.paho (inittab will respawn)
KILL_URL='http://'$EXTERNAL_CAM_IP'/phpshell.php?command=killall%20mqttclient.paho'
curl -v --connect-timeout 2 $KILL_URL

for OTHER_CAM_IP in $OTHER_CAM_IPS
do
  curl -v --connect-timeout 2 "http://${OTHER_CAM_IP}/phpshell.php?command=killall%20mqttclient.paho" &
done

sleep 1

# Kill any mjpg_streamers hanging around before renice
killall -9 mjpg_streamer

# Default is prod set in scini-cockpit/openrov/Dockerfile
if [ "$SETENV" = "dev" ]
then
    USE_MOCK=false MAX_CAMERAS=5 EXTERNAL_CAM=true EXTERNAL_CAM_URL='http://'$EXTERNAL_CAM_IP':8081/bmimg' NODE_ENV='development' PLATFORM='scini' DEBUG=$DEBUGFLAGS BOARD='surface' HARDWARE_MOCK=false DEV_MODE=false cacheDirectory='/tmp/cache' DATADIR='/tmp' LOG_LEVEL='debug' IGNORE_CACHE=true configfile='/tmp/rovconfig.json' pluginsDownloadDiretory='/tmp/plugins' photoDirectory="/tmp" video_url='http://'$EXTERNAL_CAM_IP':8081/bmimg' env plugins__ui-manager__selectedUI='new-ui' node --inspect src/cockpit.js 2>&1 | tee -a /opt/openrov/logs/`date +%d%h%H%M`-`basename $0`-$SETENV.txt
elif [ "$SETENV" = "orovmock" ]
then
    USE_MOCK=true MAX_CAMERAS=5 MOCK_VIDEO_TYPE=MJPEG EXTERNAL_CAM=false NODE_ENV='development' PLATFORM='scini' DEBUG=$DEBUGFLAGS BOARD='surface' HARDWARE_MOCK=true DEV_MODE=false cacheDirectory='/tmp/cache' DATADIR='/tmp' LOG_LEVEL='debug' IGNORE_CACHE=true configfile='/tmp/rovconfig.json' pluginsDownloadDiretory='/tmp/plugins' photoDirectory="/tmp" video_url='http://'$EXTERNAL_CAM_IP':8081/bmimg' env plugins__ui-manager__selectedUI='new-ui' node --inspect src/cockpit.js 2>&1 | tee -a /opt/openrov/logs/`date +%d%h%H%M`-`basename $0`-$SETENV.txt
else
    USE_MOCK=false MAX_CAMERAS=5 EXTERNAL_CAM=true EXTERNAL_CAM_URL='http://'$EXTERNAL_CAM_IP':8081/bmimg' NODE_ENV='production' PLATFORM='scini' BOARD='surface' HARDWARE_MOCK=false DEV_MODE=false cacheDirectory='/tmp/cache' DATADIR='/tmp' LOG_LEVEL='warn' IGNORE_CACHE=true configfile='/tmp/rovconfig.json' pluginsDownloadDiretory='/tmp/plugins' photoDirectory="/tmp" video_url='http://'$EXTERNAL_CAM_IP':8081/bmimg' env plugins__ui-manager__selectedUI='new-ui' node src/cockpit.js  2>&1 | tee -a /opt/openrov/logs/`date +%d%h%H%M`-`basename $0`-$SETENV.txt
fi

