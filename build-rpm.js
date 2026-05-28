const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');

const execPromise = util.promisify(exec);

// Absolute paths
const projectDir = __dirname;
const distDir = path.join(projectDir, 'dist');
const unpackedDir = path.join(distDir, 'linux-unpacked');
const rpmbuildDir = path.join(distDir, 'rpmbuild');

// Spec file definition
const specContent = `Name:           pocketlint
Version:        1.0.0
Release:        1
Summary:        PipeWire Audio Logical Y-Split Recorder and Pocket AI Uploader
License:        MIT
URL:            https://github.com/paul/pocketlint
BuildArch:      x86_64

# Disable debuginfo package generation (not needed for packaged Electron app)
%define debug_package %{nil}

# Disable automatic dependency generation to prevent false dependency requirements
# from chromium/electron internal shared libraries
AutoReqProv:    no

# Explicitly declare the dependencies required by the application
Requires:       pipewire-utils
Requires:       pulseaudio-utils
Requires:       ffmpeg
Requires:       alsa-lib
Requires:       gtk3
Requires:       nss
Requires:       libXScrnSaver
Requires:       libXtst
Requires:       mesa-libgbm

%description
PocketLint is an Electron-based desktop application for Linux that manages
an audio logical Y-split using PipeWire to record combined system audio and
microphone input into a single WAV file, and uploads the completed recording
to HeyPocketAI via public APIs.

%prep
# No prep needed

%build
# No build needed (app is pre-compiled)

%install
# Create directories inside the BUILDROOT staging folder
mkdir -p %{buildroot}/opt/PocketLint
mkdir -p %{buildroot}%{_bindir}
mkdir -p %{buildroot}%{_datadir}/applications

# Copy the pre-compiled electron app files from the sources folder
cp -r %{_topdir}/SOURCES/linux-unpacked/* %{buildroot}/opt/PocketLint/

# Create a symbolic link in the standard user binary directory
ln -sf /opt/PocketLint/pocketlint %{buildroot}%{_bindir}/pocketlint

# Create the desktop launcher file
cat << 'EOF' > %{buildroot}%{_datadir}/applications/pocketlint.desktop
[Desktop Entry]
Name=PocketLint
Comment=PipeWire Audio Logical Y-Split Recorder and Pocket AI Uploader
Exec=/usr/bin/pocketlint
Terminal=false
Type=Application
Icon=pocketlint
Categories=AudioVideo;Audio;Recorder;
EOF

%files
%defattr(-,root,root,-)
/opt/PocketLint
%exclude /opt/PocketLint/chrome-sandbox
%{_bindir}/pocketlint
%{_datadir}/applications/pocketlint.desktop

# Special permissions for the chrome-sandbox binary to function properly
%attr(4755, root, root) /opt/PocketLint/chrome-sandbox
`;

async function cleanDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

async function build() {
  try {
    console.log('Step 1: Compiling Electron application directory...');
    // Ensure the output directory is generated first
    await execPromise('npx electron-builder --linux --dir', { cwd: projectDir });
    console.log('App directory compiled successfully in dist/linux-unpacked/');

    if (!fs.existsSync(unpackedDir)) {
      throw new Error(`Unpacked directory not found at: ${unpackedDir}`);
    }

    console.log('Step 2: Preparing rpmbuild directories...');
    // Clean and recreate rpmbuild directory tree
    await cleanDir(rpmbuildDir);
    fs.mkdirSync(rpmbuildDir, { recursive: true });
    
    const subDirs = ['BUILD', 'BUILDROOT', 'RPMS', 'SOURCES', 'SPECS', 'SRPMS'];
    for (const subDir of subDirs) {
      fs.mkdirSync(path.join(rpmbuildDir, subDir), { recursive: true });
    }

    // Link compiled files into SOURCES/linux-unpacked
    console.log('Linking compiled files to rpmbuild sources...');
    const sourceLinkDir = path.join(rpmbuildDir, 'SOURCES', 'linux-unpacked');
    fs.symlinkSync(unpackedDir, sourceLinkDir, 'dir');

    // Write the spec file
    console.log('Writing pocketlint.spec...');
    const specFilePath = path.join(rpmbuildDir, 'SPECS', 'pocketlint.spec');
    fs.writeFileSync(specFilePath, specContent, 'utf8');

    console.log('Step 3: Compiling RPM package using system rpmbuild...');
    const rpmbuildCommand = `rpmbuild --define "_topdir ${rpmbuildDir}" -bb ${specFilePath}`;
    console.log(`Executing: ${rpmbuildCommand}`);
    
    const { stdout, stderr } = await execPromise(rpmbuildCommand);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    console.log('Step 4: Extracting built RPM...');
    const rpmsArchDir = path.join(rpmbuildDir, 'RPMS', 'x86_64');
    if (!fs.existsSync(rpmsArchDir)) {
      throw new Error(`RPM output directory not found at: ${rpmsArchDir}`);
    }

    const files = fs.readdirSync(rpmsArchDir);
    const rpmFile = files.find(f => f.endsWith('.rpm'));
    if (!rpmFile) {
      throw new Error('No .rpm file found in the output directory!');
    }

    const srcRpmPath = path.join(rpmsArchDir, rpmFile);
    const destRpmPath = path.join(distDir, rpmFile);
    
    // Copy the RPM to the dist/ folder
    fs.copyFileSync(srcRpmPath, destRpmPath);
    console.log(`\nSuccessfully created RPM package: ${destRpmPath}`);

    // Clean up temporary rpmbuild files
    console.log('Cleaning up temporary rpmbuild workspace...');
    await cleanDir(rpmbuildDir);
    console.log('Done!');
  } catch (err) {
    console.error('\nPackaging failed:', err);
    process.exit(1);
  }
}

build();
