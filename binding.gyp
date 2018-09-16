{
  "targets": [
    {
      "target_name": "triangle-node",
      "sources": [
        "native/binding/binding.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "native/triangle"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")",
        "libtriangle"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_CPP_EXCEPTIONS"]
    },
    {
      "target_name": "libtriangle",
      "type": "static_library",
      "sources": ["native/triangle/triangle.c"],
      "cflags": ["-O3", "-w", "-s"],
      "defines": ["TRILIBRARY", "CDT_ONLY"]
    }
  ]
}
