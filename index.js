// CONFIG

// directory to add images to
// here we are putting them in static, rather than assets
let uploadImagesDir = './static/assets/cms_images'

// a directus user token that has access to reading assets
const userToken = ''

const DirectusSDK = require('@directus/sdk-js');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch')
const {pipeline} = require('stream')
const {promisify} = require('util')

/**
 * Convert `const http` to variable to change protocol from project options
 */
// let http = require('https');
const { COPYFILE_FICLONE_FORCE } = require('constants');

const imageTypes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
]

// TODO ADD CLEANUP OF UNUSED IMAGES / FILES
let download = async (url, imgName) => {

  const dest = uploadImagesDir + '/' + imgName

  if (fs.existsSync(dest)) return imgName;

  console.log(' -- Downloading Resource: ' + imgName);

  return new Promise(async (resolve, reject) => {
    try {
      const streamPipeline = promisify(pipeline)
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer: ${userToken}`
        }
      })
      if (!response.ok) throw new Error(`unexpected response ${response.statusText}`)
      await streamPipeline(response.body, fs.createWriteStream(dest))
      resolve(imgName)
    } catch (e) {
      reject(e.message)
    }
  });
};

function sanitizeFields(fields) {
  Object.keys(fields).forEach((key) => {
    if (fields[key] === null || fields[key] === undefined) {
      delete fields[key];
    }
  });
  return fields;
}

function sanitizeItem(fields) {
  let { id, title, slug, path, date, content, excerpt } = fields;

  let _id = id.toString();

  delete fields.id;
  fields._directusID = _id;

  return sanitizeFields(fields);
}

/**
 * Convert nested object to flat object
 * https://stackoverflow.com/questions/34513964/how-to-convert-this-nested-object-into-a-flat-object
 * */
function traverseAndFlatten(currentNode, target, flattenedKey) {
  for (var key in currentNode) {
    if (currentNode.hasOwnProperty(key)) {
      var newKey;
      if (flattenedKey === undefined) {
        newKey = key;
      } else {
        newKey = flattenedKey + '__' + key;
      }

      var value = currentNode[key];
      if (typeof value === "object") {
        traverseAndFlatten(value, target, newKey);
      } else {
        target[newKey] = value;
      }
    }
  }
}

function flatten(obj) {
  var flattenedObject = {};
  traverseAndFlatten(obj, flattenedObject);
  return flattenedObject;
}
/**
 * End. https://stackoverflow.com/questions/34513964/how-to-convert-this-nested-object-into-a-flat-object
 * */

async function checkForImages(item, apiUrl, metas, filenameLookup) {
  for (const itemKey in item) {
    const itemContent = item[itemKey];
    const isFileImage = metas && metas[itemKey] && metas[itemKey].meta && metas[itemKey].meta.interface === 'file-image'
    const isMarkdown = metas && metas[itemKey] && metas[itemKey].meta && metas[itemKey].meta.interface === 'input-rich-text-md'
    if (itemContent && isFileImage) {
      // console.log("downloading image", apiUrl + 'assets/' + itemContent);
      item[itemKey] = await download(apiUrl + '/assets/' + itemContent, filenameLookup[itemContent]);
    } else if (itemContent && isMarkdown) {
      const matches = itemContent.matchAll(/!\[([^\]]*)\]\(([^\)]*)\)/g)
      for (const match of matches) {
        // 0: full string, 1: alt text, 2: url
        const urlMatch = match[2].match(/\/assets\/([^\/]+)/)
        const fileKey = urlMatch && urlMatch[1]
        const fileName = fileKey && filenameLookup[fileKey]
        if (fileName) {
          await download(apiUrl + '/assets/' + fileKey, fileName)
          item[itemKey] = item[itemKey].replace(match[2], `/assets/cms_images/${fileName}`)
        }
      }
    } else if (itemContent && itemKey !== 'owner' && typeof itemContent === 'object' && Object.keys(itemContent).length > 0) {
      item[itemKey] = await checkForImages(itemContent, apiUrl);
    }
  }

  return item;
}

async function checkForDownloads(item, apiUrl) {

  for (const itemKey in item) {
    const itemContent = item[itemKey];
    if (itemContent && itemContent.type && itemContent.data) {
      item[itemKey].gridsome_link = await download(apiUrl + 'assets/' + itemContent.filename_download, itemContent.filename_disk, './.cache-directus/file-cache');
    } else if (itemContent && itemKey !== 'owner' && typeof itemContent === 'object' && Object.keys(itemContent).length > 0) {
      item[itemKey] = await checkForDownloads(itemContent, apiUrl);
    }
  }

  return item;
}

class DirectusSource {
  static defaultOptions() {
    return {
      typeName: 'Directus',
      apiUrl: undefined,
      project: '_',
      staticToken: undefined,
      email: undefined,
      password: undefined,
      maxRetries: 3,
      reconnectTimeout: 10000,
      collections: []
    }
  }

  constructor(api, options) {
    this.api = api;
    this.options = options;

    /**
     * Options for setting download protocol && images upload directory
     */
    if (options.global) {
      if (options.global.protocol) {
        http = require(options.global.protocol)
      }
      if (options.global.uploadImagesDir) {
        uploadImagesDir = options.global.uploadImagesDir
      }
    }
    api.loadSource(args => this.fetchContent(args));
  }

  async fetchContent(store) {
    const { addCollection, getContentType, slugify } = store
    const { apiUrl, project, staticToken, email, password, collections, maxRetries, reconnectTimeout } = this.options

    const directusOptions = {
      url: apiUrl,
      project: project,
      token: staticToken,
    };


    const client = new DirectusSDK(apiUrl, directusOptions);

    let retries = 0;

    let connect = async () => {
      return new Promise(async (resolve, reject) => {
        try {
          await client.auth.login(Object.assign({ email, password }));
          resolve(await client.collections.read());
        } catch (e) {
          console.error("DIRECTUS ERROR: Can not login to Directus", e.message);

          if (retries < maxRetries) {
            retries++;
            console.log("DIRECTUS - Retrying to connect in 10 seconds...");

            setTimeout(async () => {
              await connect();
            }, reconnectTimeout);
          } else {
            reject(process.exit(1))
            throw new Error("DIRECTUS ERROR: Can not login to Directus");
          }
        }
      });
    }

    if (email && password) {
      let data = await connect();
    }

    console.log("DIRECTUS: Loading data from Directus at: " + apiUrl);

    if (collections.length <= 0) {
      console.error("DIRECTUS ERROR: No Directus collections specified!");
      process.exit(1)
    }

    // get a list of all files for later download use
    const files = (await client.files.read()).data
    const filenameLookup = {}
    files.forEach(f => {
      filenameLookup[f.id] = f.filename_disk
    })

    // first get all collection metadata
    const fields = (await client.fields.read()).data
    const fieldLookup = {}
    fields
      .forEach(f => {
        if (!fieldLookup[f.collection]) {
          fieldLookup[f.collection] = {}
        }
        fieldLookup[f.collection][f.field] = f
      })

    for (const collection of collections) {
      let collectionName;
      let params;
      let directusPathName;
      if (typeof collection === 'object') {
        collectionName = collection.name;
        directusPathName = collection.directusPathName || collectionName
        delete collection.name;
        params = collection;
      } else {
        collectionName = collection;
      }

      try {
        if (!params.limit) {
          params.limit = -1;
        }

        let data = await client.items(directusPathName).read(params);
        data = data.data;

        let route;

        if (params) {
          if (params.hasRoute) {
            route = `/${slugify(collectionName)}/:slug`;
          } else if (params.route) {
            if (typeof params.route === 'function') {
              route = params.route(collectionName, collection, slugify);
            } else {
              route = params.route;
            }
          }
        }

        const contentType = addCollection({
          typeName: collectionName, // TODO change name creation
          route: route
        })

        for (let item of data) {

          if (params.downloadImages) {
            item = await checkForImages(item, apiUrl, fieldLookup[collectionName], filenameLookup);
          }

          if (params.downloadFiles) {
            item = await checkForDownloads(item, apiUrl);
          }

          /**
           * Convert nested object to flat object
           */
          if (params.flat) {
            item = flatten(item);
          }

          /**
           * Check if params.sanitizeID === false to sanitize Node ID or not
           */
          if (params.sanitizeID === false) {
            contentType.addNode(sanitizeFields(item))
          }
          else {
            contentType.addNode(sanitizeItem(item))
          }
        }

      } catch (e) {
        console.error("DIRECTUS ERROR: Can not load data for collection '", e);
        process.exit(1)
        throw "DIRECTUS ERROR: Can not load data for collection '" + collectionName + "'!";
      }
    }

    console.log("DIRECTUS: Loading done!");

  }
}

module.exports = DirectusSource