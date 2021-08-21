include common.mk

SKYNET_MAKEFILE=skynet/Makefile

$(SKYNET_MAKEFILE):
	git submodule update --init

build-lua:
ifeq ($(CLONEFUNC),true)
	cd skynet/3rd/lua && $(MAKE) CC='$(CC) -std=gnu99 -fPIC' $(PLAT)
endif

build-skynet: | $(SKYNET_MAKEFILE)
	cd skynet && $(MAKE) PLAT=$(PLAT) $(SKYNET_DEP_PATH)

copy-skynet-bin:
	cp skynet/3rd/lua/lua $(BIN_DIR)
	cp skynet/3rd/lua/luac $(BIN_DIR)

skynet: build-lua build-skynet copy-skynet-bin

clean-skynet:
	cd skynet && $(MAKE) $(SKYNET_DEP_PATH) clean

clean: clean-skynet

all: skynet



$(CSERVICE_DIR)/snjs.so: | $(SKYNET_TS_FILE)
	export V8_FROM_SOURCE=1 && cd skynet_ts && cargo build --release && cp target/release/libsndeno.so $(CSERVICE_DIR)/snjs.so

ts_src=$(shell find demo -name "*.ts")
js_dst=$(patsubst %.ts, %.js, $(ts_src))
$(word 1, $(js_dst)): $(ts_src)
	tsc -p demo/ --outDir js

skynet_ts: $(CSERVICE_DIR)/snjs.so $(word 1, $(js_dst))

all: skynet_ts


clean:
	-rm -rf $(BUILD_DIR)
