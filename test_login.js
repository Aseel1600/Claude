const bcrypt = require("bcryptjs");
async function run() {
  const hash = "$2b$12$NaM4ZGGDTqtLlyVSlu5P4ObF8It0q90aHvVjvUl6YxKxxp7AZRPjq";
  console.log("6666:", await bcrypt.compare("6666", hash));
  console.log("admin123:", await bcrypt.compare("admin123", hash));
  console.log("CHANGEME:", await bcrypt.compare("CHANGEME", hash));
}
run();
