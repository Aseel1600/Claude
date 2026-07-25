{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    go_latest
    gcc
    sqlite
  ];

  shellHook = ''
    export GOPATH="$PWD/.gopath"
    export GOMODCACHE="$GOPATH/pkg/mod"
    export PATH="$GOPATH/bin:$PATH"
    echo "Go $(go version | awk '{print $3}') ready"
  '';
}
