# Bundled Mosh client

Sheller includes a portable Windows `mosh-client` built from MSYS2 packages so Mosh sessions work without a separate Mosh or WSL installation.

## Included files

- `usr/bin/mosh-client.exe` — Mosh 1.4.0, MSYS2 package `mosh-1.4.0-6`
- `usr/bin/msys-2.0.dll` — MSYS2 runtime 3.6.12, package `msys2-runtime-3.6.12-1`
- `usr/bin/msys-crypto-3.dll` — OpenSSL 3.6.5, package `libopenssl-3.6.5-1`
- `usr/bin/msys-gcc_s-seh-1.dll`, `usr/bin/msys-stdc++-6.dll` — GCC 16.2.0 runtime, package `gcc-libs-16.2.0-1`
- `usr/bin/msys-ncursesw6.dll` — ncurses 6.6, package `ncurses-6.6-2`
- `usr/bin/msys-protobuf-32.dll` — protobuf 21.12.3, package `protobuf-21.12-3`
- `usr/bin/msys-z.dll` — zlib 1.3.2, package `zlib-1.3.2-1`
- `usr/lib/terminfo/{6d,78}/*` — terminal descriptions from `ncurses-6.6-2`

The client is started with `TERMINFO=/usr/lib/terminfo`; the MSYS2 root is the directory that contains `usr/bin/mosh-client.exe`.

## Licenses

- Mosh: GPL-3.0-or-later — see `licenses/mosh-COPYING.txt`
- MSYS2 runtime (Cygwin): LGPL-3.0-or-later for the runtime DLL, with the Cygwin linking exception — see `licenses/CYGWIN_LICENSE`, `licenses/LGPL-3.0.txt`, `licenses/cygwin-COPYING`
- OpenSSL: Apache-2.0 — see `licenses/libopenssl-LICENSE.txt`
- GCC runtime libraries: GPL-3.0-or-later with the GCC Runtime Library Exception; libgcc/libstdc++ also carry LGPL-2.1-or-later terms — see `licenses/gcc-libs-*`
- ncurses: MIT — see `licenses/ncurses-LICENSE`
- protobuf: BSD-3-Clause — see `licenses/protobuf-LICENSE`
- zlib: zlib license — see `licenses/zlib-LICENSE`

The MIT license of Sheller does not apply to these third-party binaries.

## Source code

The exact binary packages were obtained from the MSYS2 `msys` repository:

- https://mirror.msys2.org/msys/x86_64/mosh-1.4.0-6-x86_64.pkg.tar.zst
- https://mirror.msys2.org/msys/x86_64/msys2-runtime-3.6.12-1-x86_64.pkg.tar.zst
- https://mirror.msys2.org/msys/x86_64/libopenssl-3.6.5-1-x86_64.pkg.tar.zst
- https://mirror.msys2.org/msys/x86_64/gcc-libs-16.2.0-1-x86_64.pkg.tar.zst
- https://mirror.msys2.org/msys/x86_64/ncurses-6.6-2-x86_64.pkg.tar.zst
- https://mirror.msys2.org/msys/x86_64/protobuf-21.12-3-x86_64.pkg.tar.zst
- https://mirror.msys2.org/msys/x86_64/zlib-1.3.2-1-x86_64.pkg.tar.zst

Source-only tarballs for the exact packages:

- https://mirror.msys2.org/msys/sources/mosh-1.4.0-6.src.tar.zst
- https://mirror.msys2.org/msys/sources/msys2-runtime-3.6.12-1.src.tar.zst
- https://mirror.msys2.org/msys/sources/openssl-3.6.5-1.src.tar.zst
- https://mirror.msys2.org/msys/sources/gcc-16.2.0-1.src.tar.zst
- https://mirror.msys2.org/msys/sources/ncurses-6.6-2.src.tar.zst
- https://mirror.msys2.org/msys/sources/protobuf-21.12-3.src.tar.zst
- https://mirror.msys2.org/msys/sources/zlib-1.3.2-1.src.tar.zst

Package metadata and source-package links:

- https://packages.msys2.org/package/mosh?repo=msys&arch=x86_64
- https://packages.msys2.org/package/msys2-runtime?repo=msys&arch=x86_64
- https://packages.msys2.org/package/libopenssl?repo=msys&arch=x86_64
- https://packages.msys2.org/package/gcc-libs?repo=msys&arch=x86_64
- https://packages.msys2.org/package/ncurses?repo=msys&arch=x86_64
- https://packages.msys2.org/package/protobuf?repo=msys&arch=x86_64
- https://packages.msys2.org/package/zlib?repo=msys&arch=x86_64

Upstream projects:

- Mosh 1.4.0: https://github.com/mobile-shell/mosh/tree/mosh-1.4.0
- MSYS2 runtime: https://github.com/msys2/msys2-runtime
- OpenSSL: https://github.com/openssl/openssl
- GCC: https://gcc.gnu.org/git/gcc.git
- ncurses: https://invisible-island.net/ncurses/
- protobuf: https://github.com/protocolbuffers/protobuf
- zlib: https://github.com/madler/zlib

For a copy of the corresponding source code, use the source-package links above or open an issue in the Sheller repository. The binaries are unmodified copies of the files in the MSYS2 packages; only the `mosh-client` executable, its runtime DLLs, and the required terminfo entries are included.
