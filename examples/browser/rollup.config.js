//
//  Copyright Yahoo Inc.
//  Licensed under the terms of the Apache 2.0 license. See LICENSE file in project root for terms.
//

import { nodeResolve } from '@rollup/plugin-node-resolve'

export default {
    input: 'main.js',
    external: ['behavior-graph'],
    output: {
        file: 'public/bundle.js',
        format: 'iife',
        globals: {
            'behavior-graph': 'bg'
        }
    },
    plugins:[nodeResolve()]
}
