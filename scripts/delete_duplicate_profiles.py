#!/usr/bin/env python3
"""Script to delete duplicate profiles from the Meticulous machine."""

import sys
import os

sys.path.insert(0, '/app/mcp-server/meticulous-mcp/src')
os.environ['METICULOUS_API_URL'] = 'http://192.168.50.168'

from meticulous_mcp.api_client import MeticulousAPIClient
from meticulous_mcp.profile_validator import ProfileValidator
from meticulous_mcp.tools import initialize_tools, delete_profile_tool

# Initialize
api_client = MeticulousAPIClient('http://192.168.50.168')
validator = ProfileValidator(schema_path='/app/espresso-profile-schema/schema.json')
initialize_tools(api_client, validator)

profiles_to_delete = [
    'yirgacheffe_you_kidding_me',
    'yirgacheffe-you-kidding-me',
]

for profile_id in profiles_to_delete:
    print(f'Attempting to delete {profile_id}...')
    try:
        result = delete_profile_tool(profile_id)
        print(f'  Success: {result}')
    except Exception as e:
        print(f'  Error: {type(e).__name__}: {e}')
    print()
