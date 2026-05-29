#!/bin/bash
set -e

cd /home/nico/Documents/Memora

git fetch origin
git reset --hard origin/feature/hosting

bash ~/deploy-memora-frontend.sh
bash ~/deploy-memora-backend.sh