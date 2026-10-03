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
        # The fork's install needs a writable HOME for pnpm's store and cache.
        HOME = "/tmp";
        dontConfigure = true;
        buildPhase = ''
          runHook preBuild
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
          mkdir -p "$out/lib/dshx"
          cp -r package.json packages/dshx/dist "$out/lib/dshx/"
          cp -r packages/dshx/node_modules "$out/lib/dshx/node_modules"
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
    in
    {
      packages.${system} = {
        dshx = dshxPkg;
        default = dshxPkg;
      };

      apps.${system}.default = {
        type = "app";
        program = "${dshxPkg}/bin/dshx";
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = [
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