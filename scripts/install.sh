#!/usr/bin/env bash

set -euo pipefail

repo="daltonkyemiller/switchboard"
prefix="${PREFIX:-/usr/local}"
version="${VERSION:-latest}"
tmux_plugin_dir="${TMUX_PLUGIN_DIR:-$HOME/.tmux/plugins/switchboard}"
tarball_url="${SWITCHBOARD_TARBALL_URL:-}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "switchboard install: missing required command: $1" >&2
    exit 1
  fi
}

target_arch() {
  case "$(uname -m)" in
    x86_64) printf '%s\n' "linux-x64" ;;
    aarch64 | arm64) printf '%s\n' "linux-arm64" ;;
    *)
      echo "switchboard install: unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

target_os() {
  case "$(uname -s)" in
    Linux) printf '%s\n' "linux" ;;
    *)
      echo "switchboard install: only Linux release tarballs are available right now" >&2
      exit 1
      ;;
  esac
}

install_command() {
  if [[ -d "$prefix" && -w "$prefix" ]]; then
    install_tool=(install)
    return
  fi

  if [[ ! -e "$prefix" && -w "$(dirname "$prefix")" ]]; then
    install_tool=(install)
    return
  fi

  need sudo
  install_tool=(sudo install)
}

download_url() {
  local target="$1"

  if [[ -n "$tarball_url" ]]; then
    printf '%s\n' "$tarball_url"
    return
  fi

  if [[ "$version" == "latest" ]]; then
    printf 'https://github.com/%s/releases/latest/download/switchboard-%s.tar.gz\n' "$repo" "$target"
    return
  fi

  printf 'https://github.com/%s/releases/download/%s/switchboard-%s.tar.gz\n' "$repo" "$version" "$target"
}

need curl
need tar
need install
target_os >/dev/null

target="$(target_arch)"
package_name="switchboard-$target"
work_dir="$(mktemp -d)"
install_tool=()
install_command

cleanup() {
  rm -rf "$work_dir"
}

trap cleanup EXIT

archive_path="$work_dir/$package_name.tar.gz"
curl -fsSL "$(download_url "$target")" -o "$archive_path"
tar -xzf "$archive_path" -C "$work_dir"

"${install_tool[@]}" -d "$prefix/bin"
"${install_tool[@]}" -m 0755 "$work_dir/$package_name/bin/switchboard" "$prefix/bin/switchboard"
"${install_tool[@]}" -d "$prefix/lib/switchboard"
"${install_tool[@]}" -m 0644 "$work_dir/$package_name/lib/switchboard/libopentui.so" "$prefix/lib/switchboard/libopentui.so"

mkdir -p "$tmux_plugin_dir"
install -m 0644 "$work_dir/$package_name/plugin.tmux" "$tmux_plugin_dir/plugin.tmux"

cat <<EOF
switchboard installed:
  binary: $prefix/bin/switchboard
  native library: $prefix/lib/switchboard/libopentui.so
  tmux plugin: $tmux_plugin_dir/plugin.tmux

Add this to ~/.tmux.conf if it is not already there:
  run-shell $tmux_plugin_dir/plugin.tmux

Then reload tmux:
  tmux source-file ~/.tmux.conf
EOF
