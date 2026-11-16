{
  inputs = {
    nixpkgs = {
      url = "github:nixos/nixpkgs/nixpkgs-unstable";
    };
    systems.url = "github:nix-systems/default-linux";
    tinfoil-proxy = {
      url = "github:tinfoilsh/tinfoil-proxy";
      flake = false;
    };
    wrap = {
      url = "github:rti/nixwrap";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.systems.follows = "systems";
    };
  };
  outputs =
    {
      nixpkgs,
      systems,
      tinfoil-proxy,
      wrap,
      ...
    }:
    nixpkgs.lib.foldl (
      acc: system:
      let
        pkgs = import nixpkgs { inherit system; };
        root = builtins.getEnv "PWD";
        dshHome = "${root}/.dsh";
      in
      pkgs.lib.attrsets.recursiveUpdate acc {
        devShells.${system} = {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bubblewrap
              (wrap.lib.${stdenv.hostPlatform.system}.mkWrap {
                name = "dsh";
                package = deepseek-harness;
                executable = "dsh";
                shareCwd = false;
                capabilities.hostNetwork = true;
                mounts = {
                  readOnly = [ ];
                  writable = [
                    "${dshHome}"
                    "${root}/ai-develop"
                  ];
                };
                environment = {
                  DSH_HOME = null;
                  TINFOIL_API_KEY = null;
                };
                arguments = [ ];
              })

              gh
              nodejs_latest
              pnpm
              typescript
            ];

            shellHook = ''
              echo "Let's get coding!"

              export DSH_HOME="${dshHome}"
              export TINFOIL_API_KEY="$(cat ${root}/.tinfoil-api-key)"
            '';
          };
        };
      }
    ) { } (import systems);
}
