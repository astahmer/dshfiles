{
  description = "Development shell and tooling for dshfiles";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      perSystem = pkgs:
    let
      # dshx is the Node CLI that builds our plugins, and it is ours: the
      # complete source lives in this flake at tooling/dshx, with no upstream
      # remote and no registry install behind it. Dependencies come from a
      # hash-pinned fixed-output fetch, so the build itself has no network.
      # After a lockfile change, set `hash = "";`, build, and copy the hash the
      # mismatch reports.
      dshxPkg = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
        pname = "dshx";
        version = "0.1.4-preview.3";
        src = builtins.path {
          name = "dshx-source";
          path = ./tooling/dshx;
          filter = path: _type: !(builtins.elem (baseNameOf path) [ "node_modules" "dist" "output" ]);
        };
        pnpmDeps = pkgs.fetchPnpmDeps {
          inherit (finalAttrs) pname version src;
          pnpm = pkgs.pnpm;
          fetcherVersion = 4;
          # pnpm 12 also writes unpacked packages to the store's links/ directory.
          # It is derived from files/ and index.db, and its comment-bearing
          # tsconfig.json files break the fetcher's jq normalization.
          preFixup = "rm -rf $storePath/v11/links";
          hash = "sha256-ksOvonEHUup7Tnc/J+HlJwtYKsCSHg5MfJ6OdaPqsPY=";
        };
        nativeBuildInputs = [ pkgs.nodejs_24 pkgs.pnpm pkgs.pnpmConfigHook ];
        buildPhase = ''
          runHook preBuild
          # create-dshx resolves as a workspace import from the CLI, so it has
          # to exist before this package typechecks.
          pnpm --filter create-dshx build
          pnpm --filter @dshfiles/dshx build
          runHook postBuild
        '';
        installPhase = ''
          runHook preInstall
          mkdir -p "$out/lib" "$out/bin"
          # Copying packages/dshx/node_modules alone leaves pnpm symlinks pointing
          # at the build tree's .pnpm directory, which is not part of this output.
          pnpm --filter @dshfiles/dshx deploy --prod --offline --config.inject-workspace-packages=true "$out/lib/dshx"
          printf '%s\n' \
            '#!/usr/bin/env bash' \
            'set -euo pipefail' \
            'exec ${pkgs.nodejs_24}/bin/node "'"$out"'/lib/dshx/dist/cli/bin.js" "$@"' \
            > "$out/bin/dshx"
          chmod +x "$out/bin/dshx"
          runHook postInstall
        '';
        dontFixup = true;
      });

      # The desktop shell. Packaging lives here rather than in a checked-in
      # electron-builder config because machine setup belongs in Nix, and because
      # Electron is already a cached binary in the pinned nixpkgs — no source build.
      #
      # The Host is resolved from PATH at run time rather than baked in: `dsh` is a
      # pnpm global install, not a Nix output, so pinning a path here would produce
      # an app that breaks the moment the global store moves. The wrapper passes the
      # caller's PATH through, and the shell reports a dialog naming the fix when
      # the executable is absent, which is the failure a GUI launch actually hits.
      desktop = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
        pname = "dsh-desktop";
        version = "0.1.0";
        src = ./apps/desktop;
        pnpmDeps = pkgs.fetchPnpmDeps {
          inherit (finalAttrs) pname version src;
          pnpm = pkgs.pnpm;
          fetcherVersion = 4;
          preFixup = "rm -rf $storePath/v11/links";
          hash = "sha256-15NhC5oiICDOq4bTcqFNC1AgFBPlbfKD2LB6bpjZNl4=";
        };
        nativeBuildInputs = [ pkgs.nodejs_22 pkgs.pnpm pkgs.pnpmConfigHook pkgs.electron ];
        ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
        # Electron comes from the binary cache and is never built from source.
        dontFixup = true;

        buildPhase = ''
          runHook preBuild
          pnpm run build
          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall
          mkdir -p "$out/lib/dsh-desktop"
          cp -r dist package.json "$out/lib/dsh-desktop/"
          cp -r node_modules "$out/lib/dsh-desktop/node_modules"
          mkdir -p "$out/bin"
          printf '%s\n' \
            '#!/usr/bin/env bash' \
            'set -euo pipefail' \
            'exec "$electron/bin/electron" "$out/lib/dsh-desktop" "$@"' \
            > "$out/bin/dsh-desktop"
          chmod +x "$out/bin/dsh-desktop"
          runHook postInstall
        '';
      });

    in
    {
      packages = {
        dshx = dshxPkg;
        desktop = desktop;
        default = dshxPkg;
      };

      apps = {
        default = {
          type = "app";
          program = "${dshxPkg}/bin/dshx";
        };
        desktop = {
          type = "app";
          program = "${desktop}/bin/dsh-desktop";
        };
      };

      devShell = pkgs.mkShell {
        packages = [ pkgs.fnm ];

        # dsh's native loader probe requires the official Node build. fnm only
        # prepends its directory to PATH, so pin that first. The rest of the
        # profile bin must stay: jj, secret and direnv live only there, and
        # dropping the whole directory to hide its node broke every one of them.
        shellHook = ''
          eval "$(fnm env --shell bash)"
          fnm use --install-if-missing --silent-if-unchanged
          if [ -n "''${FNM_DIR:-}" ]; then
            export PATH="$FNM_DIR/bin:$PATH"
          fi
          hash -r 2>/dev/null || true

          # One Turbo cache for every JJ workspace of this repository: Turbo keys a task on its input content, so a
          # fresh workspace replays another workspace's builds and browser checks instead of redoing them.
          # scripts/turbo-cache.mjs resolves the same location for the check entry points.
          export TURBO_CACHE_DIR="''${XDG_CACHE_HOME:-$HOME/.cache}/dshfiles/turbo"

          # pnpm comes only from fnm's corepack, pinned by packageManager; a
          # second nixpkgs pnpm would shadow it with a different version.
          echo "dshx: node $(node --version), pnpm $(pnpm --version 2>/dev/null || echo 'n/a')"
        '';
      };
    };

    outputs = forAllSystems perSystem;
    in
    {
      packages = nixpkgs.lib.mapAttrs (_: system: system.packages) outputs;
      apps = nixpkgs.lib.mapAttrs (_: system: system.apps) outputs;
      devShells = nixpkgs.lib.mapAttrs (_: system: { default = system.devShell; }) outputs;
    };
}
