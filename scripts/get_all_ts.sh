#!/bin/bash

# Check if the directory was passed as an argument
if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <project-directory>"
  exit 1
fi

# Define the base directory
DIR="$1"

# Check if the directory exists
if [ ! -d "$DIR" ]; then
  echo "Error: The directory '$DIR' does not exist."
  exit 1
fi

# Get the project title from package.json using native Bash
PACKAGE_JSON="$DIR/package.json"
if [ -f "$PACKAGE_JSON" ]; then
  PROJECT_NAME=$(grep -oP '"name"\s*:\s*"\K[^"]+' "$PACKAGE_JSON")
else
  PROJECT_NAME="Unknown Project"
fi

# File title
echo "# Listing of \`.ts\` files in the project \`$PROJECT_NAME\`"

# List all .ts files in the directory and subdirectories, ignoring node_modules
find "$DIR" \( -type d -name "node_modules" -prune \) -o \( -type f -name "*.ts" \) -print | grep -v "/node_modules/" | while read -r FILE; do
  echo -e "\n## \`$FILE\`\n"
  echo '```ts'
  cat "$FILE"
  echo '```'
done

exit 0
