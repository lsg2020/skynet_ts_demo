.PHONY: all clean build skynet

BUILD_DIR = $(PWD)/build
BIN_DIR = $(BUILD_DIR)
CLUALIB_DIR = $(BUILD_DIR)/clualib
CSERVICE_DIR = $(BUILD_DIR)/cservice
PLAT = linux

all: build

build:
	-mkdir -p $(BIN_DIR)
	-mkdir -p $(CLUALIB_DIR)
	-mkdir -p $(CSERVICE_DIR)

# skynet
all: skynet
SKYNET_MAKEFILE=skynet/Makefile

$(SKYNET_MAKEFILE):
	git submodule update --init

SKYNET_DEP_PATH= SKYNET_BUILD_PATH=$(BIN_DIR) \
		LUA_CLIB_PATH=$(CLUALIB_DIR) \
		CSERVICE_PATH=$(CSERVICE_DIR)

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


# skynet_ts
all: skynet_ts
SKYNET_TS_FILE=skynet_ts/rusty_v8/Cargo.toml

$(SKYNET_TS_FILE):
	git submodule update --init --recursive

$(CSERVICE_DIR)/snjs.so: | $(SKYNET_TS_FILE)
	export V8_FROM_SOURCE=$(PWD)/skynet_ts/rusty_v8/v8/ && cd skynet_ts && cargo build --release && cp target/release/libsnjs.so $(CSERVICE_DIR)/snjs.so

ts_src=$(shell find ts -name "*.ts")
js_dst=$(patsubst %.ts, %.js, $(ts_src))
$(word 1, $(js_dst)): $(ts_src)
	cd ts && tsc

skynet_ts: $(CSERVICE_DIR)/snjs.so $(word 1, $(js_dst))

clean:
	-rm -rf $(BUILD_DIR)
