{
  description = "Development shell and tooling for dshfiles";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  # The dshx fork is its own colocated jj/git repository and this repo
  # gitignores forks/ on purpose, so it enters the flake as its own input
  # rather than a git-tracked path.
  inputs.dshx.url = "path:./forks/dshx-fork";

  outputs = { self, nixpkgs, dshx, ... }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };

      # dshx is the Node CLI that builds our DSH plugins. Package it from the
      # fork in this repo so `dshx` always matches what the plugin builds
      # against, instead of tracking a published preview aimed at the previous
      # DSH generation.
      dshxPkg = pkgs.stdenvNoCC.mkDerivation {
        pname = "dshx";
        version = "0.1.4-preview.3";
        src = dshx;
        nativeBuildInputs = [ pkgs.nodejs_24 pkgs.pnpm ];
        # The fork's install needs a writable HOME for pnpm's store and cache.
        HOME = "/tmp";
        dontConfigure = true;
        buildPhase = ''
          runHook preBuild
          pnpm --filter @becomeopc/dshx build
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