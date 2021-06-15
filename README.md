# gridsome-source-directus9

Based on https://github.com/avatarbabe/gridsome-source-directus9, updated to work differently with images
Based on https://github.com/peXed/gridsome-source-directus, updated to support Directus 9

### Basic usage:

Since this package is not (yet) published on npm, just clone the repo and add it to your package.json file:
```javascript 
{
  "dependencies": {
    "gridsome-source-directus9": "path/to/cloned/project/folder",
  },
}
```

Add this in your gridsome.config.js:
```javascript 
module.exports = {
  plugins: [
    {
      use: "gridsome-source-directus9",
      options: {
        ...
        collections: [
          {
            name: "articles",
            fields: "*",
            downloadImages: true
          },
          ...
        ],
      },
    },
  ],
  ```
