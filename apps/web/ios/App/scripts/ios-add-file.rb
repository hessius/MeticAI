#!/usr/bin/env ruby
# Adds a source file to one or more Xcode targets by name, idempotently.
# Usage: ruby scripts/ios-add-file.rb <relative/path/to/File.swift> Target1 [Target2 ...]
require 'xcodeproj'

path = ARGV[0]
target_names = ARGV[1..]
abort "usage: ios-add-file.rb <path> <target...>" if path.nil? || target_names.empty?

proj_dir = File.expand_path(File.join(__dir__, '..'))
project = Xcodeproj::Project.open(File.join(proj_dir, 'App.xcodeproj'))

# Find or create a file reference under the group matching the file's directory.
abs = File.join(proj_dir, path)
group_path = File.dirname(path)
group = project.main_group
group_path.split('/').each { |seg| group = group[seg] || group.new_group(seg, seg) }
ref = group.files.find { |f| f.real_path.to_s == abs } || group.new_reference(abs)

target_names.each do |name|
  target = project.targets.find { |t| t.name == name }
  abort "target not found: #{name}" unless target
  already = target.source_build_phase.files.any? { |bf| bf.file_ref == ref }
  target.add_file_references([ref]) unless already
  puts "#{already ? 'exists' : 'added'}: #{path} -> #{name}"
end

project.save
