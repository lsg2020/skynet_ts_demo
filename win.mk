include common.mk

PLAT = mingw

SKYNET_MAKEFILE=skynet-mingw/Makefile

$(SKYNET_MAKEFILE):
	git submodule update --init && cd skynet-mingw && sh prepare.sh

build-lua:
ifeq ($(CLONEFUNC),true)
	cd skynet-mingw/3rd/lua && $(MAKE) CC='$(CC) -std=gnu99 -fPIC' $(PLAT)
endif

build-skynet: | $(SKYNET_MAKEFILE)
	cd skynet-mingw && $(MAKE) $(SKYNET_DEP_PATH)

copy-skynet-bin:
	cp skynet-mingw/3rd/lua/lua.exe $(BIN_DIR)
	cp skynet-mingw/3rd/lua/luac.exe $(BIN_DIR)

skynet: build-lua build-skynet copy-skynet-bin

clean-skynet:
	cd skynet-mingw && $(MAKE) $(SKYNET_DEP_PATH) clean
	cd skynet-mingw/3rd/lua && $(MAKE) clean

clean: clean-skynet

all: skynet



# cd skynet_ts && set http_proxy=http://localhost:10809 && set https_proxy=http://localhost:10809 && set V8_FROM_SOURCE=1 && cargo build --release && copy target\release\sndeno.dll ..\build\cservice\snjs.so /y
$(CSERVICE_DIR)/snjs.so: | $(SKYNET_TS_FILE)
	cp -f $(BUILD_DIR)/skynet.lib skynet_ts/

ts_src=$(shell find demo -name "*.ts")
js_dst=$(patsubst %.ts, %.js, $(ts_src))
$(word 1, $(js_dst)): $(ts_src)
	tsc -p demo/ --outDir js

skynet_ts: $(CSERVICE_DIR)/snjs.so $(word 1, $(js_dst))

all: skynet_ts


clean:
	-rm -rf $(BUILD_DIR)
