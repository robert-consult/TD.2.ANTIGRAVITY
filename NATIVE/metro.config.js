const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = {
    watchFolders: [workspaceRoot],
    resolver: {
        nodeModulesPaths: [
            path.resolve(projectRoot, 'node_modules'),
            path.resolve(workspaceRoot, 'node_modules'),
        ],
    },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
