lines=3000
time=$(date '+%Y-%m-%dT%H-%M-%S')
name="temp_${time}.log"
cp ./temp.log "./${name}"
tail -n ${lines} < "${name}" > ./temp.log