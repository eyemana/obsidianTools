const fs = require('fs');
const path = require('path');

// Define the path
const scenePath = "C:\\users\\ian\\obsidian\\WritersGroup\\Segments\\Tech Tips\\Obsidian\\POC\\Scenes";

console.log(`Checking directory: ${scenePath}`);

try {
  // Check if the directory exists
  if (!fs.existsSync(scenePath)) {
    console.error("The specified directory does not exist.");
  } else {
    // List files in the directory
    const files = fs.readdirSync(scenePath);
    console.log(`Found files in ${scenePath}:`, files);
  }
} catch (error) {
  console.error(`An error occurred: ${error.message}`);
}
