# Dev Data Folder

This folder is for development convenience. Place your `.xlsx` test files here and they will be automatically loaded when you run the app in development mode.

## Usage

1. Drop one or more `.xlsx` files into this folder
2. Start the dev server (`npm run dev`)
3. The app will automatically load and process all xlsx files from this folder

## Note

- All `.xlsx` files in this folder are ignored by git (see `.gitignore`)
- This auto-load feature only works in development mode
- In production, users will need to manually upload files
