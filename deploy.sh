#!/bin/bash
set -e

git fetch origin
git reset --hard origin/feature/hosting

./deploy-memory-frontend.sh