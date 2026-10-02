const readline = require("readline/promises");
const auth = require("../auth");

async function main() {
  let [username, password] = process.argv.slice(2);
  if (!username || !password) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    username = (await prompt.question("Login: ")).trim();
    password = await prompt.question("Password: ");
    prompt.close();
  }
  if (!username || !password) {
    console.error("Login and password are required");
    process.exit(1);
  }
  auth.saveCredentials(auth.createCredentials(username, password));
  console.log(`Admin account saved for "${username}"`);
}

main();
