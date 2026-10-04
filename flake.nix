{
  description = "Development shell and tooling for dshfiles";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };

      # dshx is the Node CLI that builds our plugins, and it is ours: the
      # complete source lives in this flake at tooling/dshx, with no upstream
      # remote and no registry install behind it.
      dshxPkg = pkgs.stdenvNoCC.mkDerivation {
        pname = "dshx";
        version = "0.1.4-preview.3";
        src = ./tooling/dshx;
        nativeBuildInputs = [ pkgs.nodejs_24 pkgs.pnpm ];
        dontConfigure = true;
        buildPhase = ''
          runHook preBuild
          # Keep pnpm's store and cache in this build's writable temporary
          # directory instead of sharing /tmp across concurrent Nix builds.
          export HOME="$TMPDIR/dshx-home"
          mkdir -p "$HOME"
          # A flake copies only git-tracked files, so the workspace has no
          # node_modules yet; install before building.
          pnpm install --frozen-lockfile --ignore-scripts
          # create-dshx resolves as a workspace import from the CLI, so it has
          # to exist before this package typechecks.
          pnpm --filter create-dshx build
          pnpm --filter @dshfiles/dshx build
          runHook postBuild
        '';
        installPhase = ''
          runHook preInstall
          export HOME="$TMPDIR/dshx-home"
          mkdir -p "$HOME"
          mkdir -p "$out/lib" "$out/bin"
          # Preserve the workspace package and its production dependency graph.
          # Copying packages/dshx/node_modules alone leaves pnpm symlinks pointing
          # at the build tree's .pnpm store, which is not part of this output.
          pnpm --filter @dshfiles/dshx deploy --prod --legacy "$out/lib/dshx"
          mkdir -p "$out/bin"
          printf '%s\n' \
            '#!/usr/bin/env bash' \
            'set -euo pipefail' \
            'exec node "'"$out"'/lib/dshx/dist/cli/bin.js" "$@"' \
            > "$out/bin/dshx"
          chmod +x "$out/bin/dshx"
          runHook postInstall
        '';
        dontFixup = true;
      };
      # The desktop shell. Packaging lives here rather than in a checked-in
      # electron-builder config because machine setup belongs in Nix, and because
      # Electron is already a cached binary in the pinned nixpkgs — no source build.
      #
      # The Host is resolved from PATH at run time rather than baked in: `dsh` is a
      # pnpm global install, not a Nix output, so pinning a path here would produce
      # an app that breaks the moment the global store moves. The wrapper passes the
      # caller's PATH through, and the shell reports a dialog naming the fix when
      # the executable is absent, which is the failure a GUI launch actually hits.
      desktop = pkgs.stdenvNoCC.mkDerivation {
        pname = "dsh-desktop";
        version = "0.1.0";
        src = ./apps/desktop;
        nativeBuildInputs = [ pkgs.nodejs_22 pkgs.pnpm pkgs.electron ];
        # Electron comes from the binary cache and is never built from source.
        dontFixup = true;

        configurePhase = ''
          export ELECTRON_SKIP_BINARY_DOWNLOAD=1
          pnpm install --frozen-lockfile --ignore-scripts
        '';

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
      };

    in
    {
      packages.${system} = {
        dshx = dshxPkg;
        desktop = desktop;
        default = dshxPkg;
      };

      apps.${system} = {
        default = {
          type = "app";
          program = "${dshxPkg}/bin/dshx";
        };
        desktop = {
          type = "app";
          program = "${desktop}/bin/dsh-desktop";
        };
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = [
          dshxPkg
          pkgs.fnm
          pkgs.pnpm
        ];

        # dsh's native loader probe requires the official Node build. fnm only
        # prepends its directory to PATH, and mkShell leaves ~/.nix-profile/bin
        # in front of it, so strip the nix node and put fnm's first.
        shellHook = ''
          eval "$(fnm env --shell bash)"
          fnm use --install-if-missing --silent-if-unchanged
          if [ -n "''${FNM_DIR:-}" ]; then
            PATH="$(echo "$PATH" | tr ':' '\n' | grep -v "^$HOME/.nix-profile/bin$" | paste -sd: -)"
            export PATH="$FNM_DIR/bin:$PATH"
          fi
          hash -r 2>/dev/null || true

          # The plugin workspace pins pnpm 12 through corepack's lastKnownGood:
          # the profile's node_modules was built by that major, and pnpm refuses
          # to link against a store from a different one.
          echo "dshx: node $(node --version), pnpm $(pnpm --version 2>/dev/null || echo 'n/a')"
        '';
      };
    };
}
