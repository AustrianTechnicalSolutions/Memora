#!/bin/bash
set -e

git fetch origin
git reset --hard origin/feature/hosting

cd ~
./deploy-memory-frontend.sh