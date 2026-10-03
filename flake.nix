{
  description = "Development shell for dshfiles";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.fnm
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
        '';
      };
    };
}
