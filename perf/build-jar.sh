#!/usr/bin/env sh
# Builds the production jar the load test runs: the frontend's production build served from the jar's
# classpath:/static/, as the Docker image does (Dockerfile stages 1 and 2), without touching src/main/resources.
# Usage: perf/build-jar.sh [--skip-frontend]   (from anywhere; needs `npm ci` in frontend/ once)
#   --skip-frontend reuses frontend/dist from an earlier build.
# Output: backend/target/notesapp-*.jar. Run `./mvnw clean` (or delete target/classes/static) before the backend
# test gates, so the tests do not see the staged frontend.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${1:-}" != "--skip-frontend" ]; then
  (cd "$root/frontend" && npm run build)
fi
cd "$root/backend"
./mvnw -B -o -q -DskipTests process-classes
rm -rf target/classes/static
mkdir -p target/classes/static
cp -R "$root/frontend/dist/." target/classes/static/
./mvnw -B -o -q -DskipTests package
ls -l target/notesapp-*.jar
