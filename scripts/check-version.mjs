/* ============================================================
   Guards a release against a version mismatch: the git tag that triggered
   the workflow must match the "version" field in package.json.

   A mismatch ships an installer whose filename, latest.yml and in-app
   version all disagree with the tag. Because electron-updater compares the
   version in latest.yml against the running app's version, a wrong number
   here either hides the release from every existing client or offers them a
   downgrade. Cheaper to fail in five seconds than to find out after publishing.

   Takes the tag from argv[2], falling back to GITHUB_REF_NAME (set by GitHub
   Actions on a tag push). Dependency-free.

   Run with:  node scripts/check-version.mjs v1.0.0
   ============================================================ */

   import { readFileSync } from "node:fs";
   import { join, dirname } from "node:path";
   import { fileURLToPath } from "node:url";


   const root = join(dirname(fileURLToPath(import.meta.url)), "..");

   const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
   if (!tag) {
        console.error('check-version: no tag supplied (pass one as an argment, or set GITHUB_REF_NAME).');
        process.exit(1);
   }

   const tagVersion = tag.replace(/^v/, "");
   const { version: packageVersion } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

   if (tagVersion !== packageVersion) {
        console.error(`check-version: tag version "${tag}" does not match package.json version "${packageVersion}".`);
        console.error(`If the tag is right, fix the manifest with: npm version ${tagVersion} --no-git-tag-version`);
        process.exit(1);
   }

   console.log(`check version: tag "${tag}" matches package.json version "${packageVersion}".`);