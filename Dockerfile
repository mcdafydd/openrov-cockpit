## Need to avoid OpenSSL 1.1.x incompatibilities with mjpg-streamer and uWebSockets so stick with
## Ubuntu 16.04 LTS or 17.10.
FROM ubuntu:17.10
LABEL maintainer="david@linkconsultinginc.com"
SHELL ["/bin/bash", "-c"]

## Install dependencies and recent NodeJS
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        libimage-exiftool-perl \
        build-essential \
        cmake \
        libssl-dev \
        g++ \
        libpcre3 \
        libpcre3-dev \
        wget \
        pkg-config \
        net-tools \
        iputils-ping \
        vim \
        python \
        dpkg-dev \
        nmap \
        tcpdump \
        libuv1 \
        libuv1-dev \
        libjpeg-dev \
        libghc-zlib-dev \
        git \
        curl \
        openssh-client \
        ca-certificates \
    && curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.11/install.sh | bash \
    && rm -rf /var/lib/apt/lists/*

## Install uWebSockets library, required for mjpg-streamer output_ws.so plugin
RUN mkdir ~/scini-code \
    && cd ~/scini-code \
    && git clone https://github.com/mcdafydd/uWebSockets.git \
    && cd uWebSockets \
    && mkdir build \
    && cd build \
    && cmake .. \
    && make \
    && make install

## Install our branch of mjpg-streamer
RUN cd ~/scini-code \
    && git clone https://github.com/mcdafydd/mjpg-streamer.git \
    && cd mjpg-streamer \
    && git checkout platform/scini \
    && sed 's/^#\ Compiler\ flags/#\ Compiler\ Flags\nadd_definitions\(-DUSE_LIBUV\)\n/' CMakeLists.txt > /tmp/tmp.$$ \
    && mv /tmp/tmp.$$ CMakeLists.txt \
    && mkdir -p build \
    && cd build \
    && cmake .. \
    && make \
    && make install

## Install node+nvm
ENV NVM_DIR /root/.nvm
ENV NODE_VERSION 6.14.2
ENV NODE_PATH $NVM_DIR/versions/node/v$NODE_VERSION/lib/node_modules
ENV PATH $NVM_DIR/versions/node/v$NODE_VERSION/bin:$PATH

RUN source ~/.nvm/nvm.sh \
    && nvm install v$NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default \
    && echo It should end saying something like "Now using node $LATEST (npm v3.10.10)"

## Install self-signed certificate *.local certificate
## As of 15 August 2017, the mjpeg-video-server node module looks for a certificate in a specific location when it is loaded.
## Grab our fork of openrov-cockpit repo
RUN mkdir -p /etc/openrov \
    && mkdir -p /opt/openrov \
    && mkdir /usr/share/cockpit \
    && cd ~/scini-code \
    && git clone -b platform/scini --recurse-submodules https://github.com/mcdafydd/openrov-cockpit.git \
    && cd openrov-cockpit \
    && cp deploy/openrov.crt deploy/openrov.key /etc/openrov/ \
    && chmod 400 /etc/openrov/openrov.key \
    && npm run deploy:prod \
    && npm run deploy:dev

## Install remaining dependency modules to run the mock platform
RUN cd ~/scini-code/openrov-cockpit \
    && npm -g install forever \
    && npm install queue \
    && (cd src/plugins/mjpeg-video && npm install) \
    && (cd src/plugins/notifications && npm install) \
    && cp -a src/plugins/notifications/node_modules/nedb/ node_modules/ \
    && (cd src/plugins/peer-view && npm install simple-peer) \
    && (cd src/plugins/peer-view && npm install msgpack-lite) \
    && (cd src/plugins/mqtt-broker && npm install bonjour)

## Install our modified mjpeg-video-server node module
RUN cd ~/scini-code/ \
    && git clone https://github.com/mcdafydd/mjpeg-video-server.git \
    && cd mjpeg-video-server \
    && git checkout feature/external-cam \
    && npm install \
    && cd .. \
    && cp -a mjpeg-video-server openrov-cockpit/src/plugins/mjpeg-video/node_modules/

## Let Docker know that OpenROV is listening on ports for HTTP, Node/Express, and Mosca MQTT
## Ports 80, 8080 = HTTP; 1883 = MQTT; 3000 = MQTT-ws; 8200 = ws://; 8300, 9229 = Node
## Run with:
## docker run -it -p 80:80 -p 1883:1883 -p 3000:3000 -p 8080:8080 -p 8200:8200 -p 8300:8300 -p 9229:9229 openrov /bin/bash
EXPOSE 80
EXPOSE 1883
EXPOSE 3000
EXPOSE 8080
EXPOSE 8200
EXPOSE 8300
EXPOSE 9229

## Start the mock server platform (no external camera)
CMD ["./start-dev.sh"]
