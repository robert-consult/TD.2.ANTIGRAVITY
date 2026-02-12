import sys
import os

def generate_tree(file_path):
    try:
        with open(file_path, 'r') as f:
            paths = [line.strip() for line in f if line.strip()]
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    paths.sort()
    
    # Filter out paths that are too deep (redundant if finding with maxdepth, but good for safety)
    # And create a tree structure
    
    # We'll just print it visually
    # For each path, find its parent and print with indentation
    
    # A simple way to print tree from sorted paths:
    # 1. Split path into parts
    # 2. Keep track of current hierarchy
    
    # Example:
    # /home
    # /home/user
    # /home/user/docs
    
    # Logic:
    # for each path:
    #   parts = path.split('/')
    #   indent based on depth relative to root
    #   print only the last part
    
    if not paths:
        print("No paths found.")
        return

    root_depth = paths[0].count('/')
    
    print("# Directory Map of /home (Depth 5)")
    print("```text")
    
    previous_parts = []
    
    for path in paths:
        # Normalize path separators
        path = path.replace('\\', '/')
        if not path.startswith('/'): # Handle mainly absolute paths starting with /
             # If it's relative, just use it
             pass
        
        parts = [p for p in path.split('/') if p]
        
        # Determine indentation
        # We need to print the parts that are different from the previous path
        
        # Find common prefix length
        common_len = 0
        for i in range(min(len(parts), len(previous_parts))):
            if parts[i] == previous_parts[i]:
                common_len += 1
            else:
                break
        
        # Print the new parts
        for i in range(common_len, len(parts)):
            indent = "    " * (i)
            print(f"{indent}|-- {parts[i]}")
            
        previous_parts = parts

    print("```")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        generate_tree(sys.argv[1])
    else:
        print("Usage: python generate_tree.py <file_list>")
