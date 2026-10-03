{
  description = "Development shell and tooling for dshfiles";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };

      # dshx is the Node CLI that builds our plugins. It is not packaged here:
      # forks/ is gitignored because the dshx fork is its own colocated
      # repository with independent history, so a flake cannot legally read it
      # as a source without nesting one repository inside another.
      #
      # The plugin workspace therefore links the fork directly, and the CLI is
      # reached through it:
      #
      #   cd plugins/@dshfiles/ai-accounts && pnpm build
      #
      # `nix run` stays available for a released dshx, once one supports the
      # DSH generation this profile runs.
    in
    {
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