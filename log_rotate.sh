BASEDIR="${BASEDIR=$(dirname "$0")}"
FILE_KEY="${FILE_KEY="temp"}"
LINES=3000

LOG_DIR="${BASEDIR}/logs"

time=$(date '+%Y-%m-%dT%H-%M-%S')
name="${LOG_DIR}/${FILE_KEY}_${time}.log"

mkdir -p "${LOG_DIR}"
cp "${BASEDIR}/${FILE_KEY}.log" "${name}"
tail -n ${LINES} < "${name}" > "${BASEDIR}/${FILE_KEY}.log"