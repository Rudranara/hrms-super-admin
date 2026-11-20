import bcrypt from "bcrypt";

const password = process.argv[2];

if (!password || password.length < 8) {
  console.error("Usage: npm run hash-password -- \"a-password-at-least-8-characters-long\"");
  process.exit(1);
}

bcrypt.hash(password, 12)
  .then((hash) => console.log(hash))
  .catch((error: unknown) => {
    console.error("Unable to generate password hash.", error);
    process.exit(1);
  });
