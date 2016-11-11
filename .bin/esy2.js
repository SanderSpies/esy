/* @flow */


/* TODO: type node = {
  name: string,
  buildCommand: string,
  buildTimeOnlyDependencies: [node],
  dependencies: [node],
  envVars:  { [key: string]: string },
  version: string,
  target: string
};*/

const fs = require('fs');
const path = require('path');
var packageResolve = require('resolve');

let visitedDependencies = {};
let globalVars = [];

// get package.json of current folder or climbs up to closest one
function findRootPackageJSON(cf) {
  let currentFolder = cf;
  function resolver (resolve, reject) {
    const packageJSONpath = path.join(currentFolder, 'package.json');
    fs.exists(packageJSONpath, exists => {
      if (exists) {
        resolve(packageJSONpath);
      }
      else {
        const newCurrentFolder = path.resolve(currentFolder, '..');
        if (newCurrentFolder === '/') {
          reject('couldn\'t find a package.json in the current folder or any of the parent folders');
        }
        else {
          currentFolder = newCurrentFolder
          resolver(resolve, reject);
        }
      }
    });
  }
  return new Promise(resolver);
}

function resolvePackageJSON(pathName) {
  function resolver(resolve, reject) {
    fs.readFile(pathName, 'utf8', (err, data) => {
      if (err) {
        reject('Could not find ' + pathName);
      }
      else {

        let pack;
        try {
          pack = JSON.parse(data);
        } catch (e) {
          reject('Invalid JSON found at ' + pathName);
          return;
        }
        if(!pack.name) {
          reject('no package name declared in: ' + pathName);
        }
        const packEnvVars = pack.exportedEnvVars;
        const esyPackage = {
          name: pack.name,
          build: pack.build,
          version: pack.version,
          exportedEnvVars: packEnvVars ? Object.keys(packEnvVars).map(
            key => ({key:key, scope: packEnvVars[key].scope, value: packEnvVars[key].val})
          ) : [],
          runtimeEnvVars: null,
          dependencies: pack.dependencies,
          deps: []
        };
        const exportedEnvVars = esyPackage.exportedEnvVars;
        esyPackage.runtimeEnvVars = exportedEnvVars.filter(({scope}) => scope === 'local');
        globalVars = globalVars.concat(exportedEnvVars.filter(({scope}) => scope === 'global'));
        if (esyPackage.dependencies) {
          resolveDependencies({pathName, package: esyPackage})
          .then(({pathName, package}) => {
            const exportedEnvVars = package.deps.map(({package}) => package.exportedEnvVars)
                                                .reduce((a, b) => a.concat(b))
                                                .filter(({scope}) => scope === 'export');
            package.runtimeEnvVars = package.runtimeEnvVars.concat(exportedEnvVars);
            return {pathName, package};
          })
          .then(resolve, reject);
        }
        else {
          resolve({pathName, package: esyPackage});
        }
      }
    });
  }
  return new Promise(resolver);
}

function resolveDependencies({pathName, package}) {
  // TODO: add support for peer and maybe others?!
  const depsPromises = !package.dependencies ? [] : Object.keys(package.dependencies).map(key => {
    if (!visitedDependencies[key]) {
      visitedDependencies[key] = true;
      return new Promise((resolve, reject) => {
        packageResolve(path.join(key, 'package.json'), {basedir: path.dirname(pathName)}, (err, res) => {
          if (err) {
            reject('Could not find dependency ' + key + ', perhaps you need to run `npm install`?')
          }
          else {
            resolvePackageJSON(res).then(resolve, reject);
          }
        });
      });
    }
  });
  return Promise.all(depsPromises)
    .then(resolvedDeps => {
      package.dependencies = null;
      package.deps = resolvedDeps;
      return {pathName, package};
    });
}

const util = require('util');
function printCurrentSandBox({pathName, package}) {
  console.log(util.inspect(package, {showHidden: false, depth: null}))
}

findRootPackageJSON(process.cwd())
.then(resolvePackageJSON)
.then(printCurrentSandBox)
.catch(err => console.info('error:', err));