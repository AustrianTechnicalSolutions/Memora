#!/bin/bash
set -e

git fetch origin
git reset --hard origin/feature/hosting

bash ~/deploy-memory-frontend.sh