.PHONY: all clean build skynet

BUILD_DIR = $(PWD)/build
BIN_DIR = $(BUILD_DIR)
CLUALIB_DIR = $(BUILD_DIR)/clualib
CSERVICE_DIR = $(BUILD_DIR)/cservice

all: build

build:
	-mkdir -p $(BIN_DIR)
	-mkdir -p $(CLUALIB_DIR)
	-mkdir -p $(CSERVICE_DIR)

# skynet
SKYNET_DEP_PATH= SKYNET_BUILD_PATH=$(BIN_DIR) \
		LUA_CLIB_PATH=$(CLUALIB_DIR) \
		CSERVICE_PATH=$(CSERVICE_DIR)


# skynet_ts
SKYNET_TS_FILE=skynet_ts/rusty_v8/Cargo.toml

$(SKYNET_TS_FILE):
	git submodule update --init --recursive



