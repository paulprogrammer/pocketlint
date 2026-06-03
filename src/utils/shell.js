const { exec, spawn, execFile } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

class ShellClient {
  exec(cmd, options) {
    return execPromise(cmd, options);
  }

  execFile(file, args, options) {
    return new Promise((resolve, reject) => {
      execFile(file, args, options, (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  execFileWithCallback(file, args, cb) {
    return execFile(file, args, cb);
  }

  execWithCallback(cmd, cb) {
    return exec(cmd, cb);
  }

  spawn(cmd, args, options) {
    return spawn(cmd, args, options);
  }
}

module.exports = new ShellClient();
