#!/usr/bin/env bash
set -ex

PARITY_VERSION=1.8.10
SOLIDITY_VERSION=0.4.21

# install dependencies and compiler
sudo add-apt-repository -y ppa:ethereum/ethereum
sudo apt-get update
sudo apt-get install ethereum software-properties-common openssl libssl-dev libudev-dev


SOLIDITY_DOWNLOAD=https://github.com/ethereum/solidity/releases/download/v${SOLIDITY_VERSION}/solc-static-linux

# install parity
PARITY_DOWNLOAD=https://parity-downloads-mirror.parity.io/v${PARITY_VERSION}/x86_64-unknown-linux-gnu/parity

# Fetch parity
curl -L $PARITY_DOWNLOAD > parity
curl -L $SOLIDITY_DOWNLOAD > solc

# Install parity and solidity compiler 
chmod +x parity
sudo mv parity /usr/bin
chmod +x solc
sudo mv solc /usr/bin

# install dapp
curl https://nixos.org/nix/install | sh
source $HOME/.nix-profile/etc/profile.d/nix.sh
nix-channel --add https://nix.dapphub.com/pkgs/dapphub
nix-channel --update
nix-env -iA dapphub.{dapp,hevm,seth}

# install oyente
sudo pip2 install z3
sudo pip2 install z3-solver
sudo pip2 install oyente
